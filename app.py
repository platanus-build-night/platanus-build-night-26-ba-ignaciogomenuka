from flask import Flask, jsonify, render_template_string, request
import requests
import os
import threading
import time
import json
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from db import get_snapshot, has_recent_event, get_last_seen_from_db, get_snapshot_at, get_replay_range
from forecast import get_forecast
from analytics import get_monthly_analytics, get_top_destinations
from airports import nearest_airport

load_dotenv()

ARGENTINA_TZ = timezone(timedelta(hours=-3))

app = Flask(__name__)

PLANES = {
    "e0659a": "LV-FVZ",
    "e030cf": "LV-CCO",
    "e06546": "LV-FUF",
    "e0b341": "LV-KMA",
    "e0b058": "LV-KAX",
}

active_planes = set()
notified_planes = set()
last_seen = {}
on_ground_state = {}
LANDING_GRACE_PERIOD = 600
APPEARED_THRESHOLD = 7200  # 2 hours


def get_db():
    return psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=psycopg2.extras.RealDictCursor)


def get_aircraft_id(cur, icao24):
    cur.execute("SELECT id FROM aircraft WHERE icao24 = %s", (icao24,))
    row = cur.fetchone()
    return row["id"] if row else None


def save_position(icao24, plane_data):
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                aircraft_id = get_aircraft_id(cur, icao24)
                if not aircraft_id:
                    return
                cur.execute("""
                    INSERT INTO positions (aircraft_id, lat, lon, altitude, velocity, heading, on_ground, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    aircraft_id,
                    plane_data.get("lat") if plane_data.get("lat") != "N/A" else None,
                    plane_data.get("lon") if plane_data.get("lon") != "N/A" else None,
                    plane_data.get("altitude") if plane_data.get("altitude") != "N/A" else None,
                    plane_data.get("velocity") if plane_data.get("velocity") != "N/A" else None,
                    plane_data.get("heading") if plane_data.get("heading") != "N/A" else None,
                    plane_data.get("on_ground", False),
                    plane_data.get("source"),
                ))
    except Exception as e:
        print(f"Error saving position: {e}")


def save_flight_event(icao24, event_type, data=None):
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                aircraft_id = get_aircraft_id(cur, icao24)
                if not aircraft_id:
                    return
                if has_recent_event(conn, aircraft_id, event_type.upper()):
                    print(f"  Dedup: skipping {event_type.upper()} for {icao24}")
                    return
                meta = dict(data or {})
                if event_type.upper() == "LANDING":
                    cur.execute("""
                        SELECT lat, lon FROM positions
                        WHERE aircraft_id = %s AND lat IS NOT NULL
                          AND ts >= NOW() - INTERVAL '5 minutes'
                        ORDER BY ts DESC LIMIT 1
                    """, (aircraft_id,))
                    pos = cur.fetchone()
                    if pos:
                        apt = nearest_airport(pos["lat"], pos["lon"])
                        meta["destination_airport"] = apt["iata"] if apt else "UNKNOWN"
                        if apt:
                            meta["destination_name"] = apt["name"]
                    else:
                        meta["destination_airport"] = "UNKNOWN"
                cur.execute("""
                    INSERT INTO events (aircraft_id, type, meta)
                    VALUES (%s, %s, %s)
                """, (aircraft_id, event_type.upper(), json.dumps(meta)))
    except Exception as e:
        print(f"Error saving event: {e}")


def load_history(limit=50):
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT e.id, e.ts, e.type, e.meta, a.tail_number AS callsign
                    FROM events e
                    JOIN aircraft a ON a.id = e.aircraft_id
                    ORDER BY e.ts DESC
                    LIMIT %s
                """, (limit,))
                rows = cur.fetchall()
                result = []
                for r in rows:
                    result.append({
                        "callsign": r["callsign"],
                        "type": r["type"],
                        "timestamp": r["ts"].isoformat(),
                        "data": r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"] or "{}")
                    })
                return result
    except Exception as e:
        print(f"Error loading history: {e}")
        return []


def get_cardinal_direction(heading):
    if heading == "N/A":
        return ""
    directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = int((heading + 22.5) / 45) % 8
    return directions[idx]


def get_vertical_status(baro_rate):
    if baro_rate == "N/A":
        return ""
    if baro_rate > 64:
        return f"⬆️ Subiendo +{baro_rate} ft/min"
    elif baro_rate < -64:
        return f"⬇️ Descendiendo {baro_rate} ft/min"
    else:
        return "➡️ Altitud estable"


def check_emergency(squawk):
    if squawk == "7700":
        return "🆘 EMERGENCIA"
    elif squawk == "7600":
        return "📻 Falla de radio"
    elif squawk == "7500":
        return "🚨 HIJACK"
    return None


def notify_telegram(msg):
    token = os.getenv("TELEGRAM_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if token and chat_id:
        try:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data={"chat_id": chat_id, "text": msg}
            )
        except Exception as e:
            print(f"Error enviando mensaje por Telegram: {e}")


def check_adsb_one(icao24):
    try:
        print(f"  Consultando ADSB.one para {icao24}...")
        response = requests.get(f"https://api.adsb.one/v2/hex/{icao24}", timeout=5)
        print(f"  ADSB.one {icao24}: status {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            if data.get("total", 0) > 0 and data.get("ac"):
                aircraft = data["ac"][0]
                return {
                    "icao24": aircraft.get("hex", "").lower(),
                    "callsign": aircraft.get("flight", "").strip() or aircraft.get("r", ""),
                    "altitude": aircraft.get("alt_baro", "N/A"),
                    "velocity": round(aircraft.get("gs", 0) * 1.852, 1) if aircraft.get("gs") else "N/A",
                    "country": "N/A",
                    "lat": aircraft.get("lat", "N/A"),
                    "lon": aircraft.get("lon", "N/A"),
                    "heading": aircraft.get("track", "N/A"),
                    "baro_rate": aircraft.get("baro_rate", "N/A"),
                    "squawk": aircraft.get("squawk", ""),
                    "on_ground": False,
                    "source": "ADSB.one"
                }
    except Exception as e:
        print(f"ADSB.one error for {icao24}: {e}")
    return None


def check_opensky():
    results = {}
    try:
        print(f"Consultando OpenSky Network...")
        response = requests.get("https://opensky-network.org/api/states/all", timeout=30)
        print(f"OpenSky response: status {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            for state in data.get("states", []):
                if len(state) < 14:
                    continue
                icao24 = state[0].lower() if state[0] else None
                if icao24 in PLANES:
                    vertical_ms = state[11] if state[11] is not None else None
                    baro_rate_fpm = round(vertical_ms * 196.85) if vertical_ms else "N/A"
                    results[icao24] = {
                        "icao24": icao24,
                        "callsign": state[1].strip() if state[1] else "",
                        "altitude": state[13] if state[13] is not None else "N/A",
                        "velocity": round(state[9] * 3.6, 1) if state[9] is not None else "N/A",
                        "country": state[2] if state[2] else "N/A",
                        "lat": state[6] if state[6] is not None else "N/A",
                        "lon": state[5] if state[5] is not None else "N/A",
                        "heading": state[10] if state[10] is not None else "N/A",
                        "baro_rate": baro_rate_fpm,
                        "squawk": state[14] if len(state) > 14 and state[14] else "",
                        "on_ground": bool(state[8]) if state[8] is not None else False,
                        "source": "OpenSky"
                    }
    except Exception as e:
        print(f"OpenSky error: {e}")
    return results


def check_flights():
    global active_planes, last_seen, notified_planes, on_ground_state
    currently_flying = set()
    planes_info = []

    current_timestamp = datetime.now().timestamp()
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - Checking OpenSky Network...")
    opensky_results = check_opensky()

    for icao24, registration in PLANES.items():
        if icao24 in opensky_results:
            currently_flying.add(registration)
            plane_data = opensky_results[icao24]
            plane_data["callsign"] = registration
            planes_info.append(plane_data)
            last_seen[registration] = current_timestamp
            save_position(icao24, plane_data)
            print(f"  Found {registration} via OpenSky")

    if len(currently_flying) < len(PLANES):
        print(f"OpenSky found {len(currently_flying)}/{len(PLANES)} planes. Checking ADSB.one for missing planes...")
        for icao24, registration in PLANES.items():
            if registration not in currently_flying:
                try:
                    plane_data = check_adsb_one(icao24)
                    if plane_data:
                        currently_flying.add(registration)
                        plane_data["callsign"] = registration
                        planes_info.append(plane_data)
                        last_seen[registration] = current_timestamp
                        save_position(icao24, plane_data)
                        print(f"  Found {registration} via ADSB.one")
                except Exception as e:
                    print(f"  Error checking {registration} on ADSB.one: {e}")
                time.sleep(0.5)

    for plane_data in planes_info:
        registration = plane_data["callsign"]
        icao24 = plane_data["icao24"]

        if registration not in active_planes:
            altitude_unit = "m" if plane_data["source"] == "OpenSky" else "ft"
            is_in_progress = registration in notified_planes
            event_icon = "🔄" if is_in_progress else "✈️"
            event_type = "en curso" if is_in_progress else "despegó"

            msg = f"{event_icon} {registration} {event_type}\nICAO24: {icao24}\n"

            emergency = check_emergency(plane_data.get('squawk', ''))
            if emergency:
                msg += f"{emergency}\n"

            lat = plane_data.get('lat', 'N/A')
            lon = plane_data.get('lon', 'N/A')
            if lat != "N/A" and lon != "N/A":
                msg += f"\n📍 Posición: {lat:.4f}, {lon:.4f}\n"

            msg += f"📊 Altitud: {plane_data['altitude']} {altitude_unit}\n"
            msg += f"🚀 Velocidad: {plane_data['velocity']} km/h\n"

            heading = plane_data.get('heading', 'N/A')
            if heading != "N/A":
                cardinal = get_cardinal_direction(heading)
                msg += f"🧭 Rumbo: {int(heading)}° ({cardinal})\n"

            vertical = get_vertical_status(plane_data.get('baro_rate', 'N/A'))
            if vertical:
                msg += f"{vertical}\n"

            msg += f"\n🔗 Ver en vivo: https://www.flightradar24.com/{registration}\n"
            msg += f"📡 Fuente: {plane_data['source']}\n"
            msg += f"🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

            notify_telegram(msg)
            notified_planes.add(registration)

            save_flight_event(icao24, "in_progress" if is_in_progress else "takeoff", {
                "icao24": icao24,
                "altitude": plane_data["altitude"],
                "velocity": plane_data["velocity"],
                "lat": plane_data["lat"],
                "lon": plane_data["lon"],
                "source": plane_data["source"]
            })

        # APPEARED: plane not seen for > 2h
        prev_ts = last_seen.get(registration)
        if prev_ts and (current_timestamp - prev_ts) > APPEARED_THRESHOLD:
            gap_h = int((current_timestamp - prev_ts) / 3600)
            save_flight_event(icao24, "appeared", {"gap_seconds": int(current_timestamp - prev_ts)})
            notify_telegram(f"👀 {registration} reapareció después de {gap_h}h sin señal")

        # EMERGENCY: save to DB (Telegram already handled above for new flights)
        squawk = plane_data.get("squawk", "")
        if squawk in ("7700", "7600", "7500"):
            save_flight_event(icao24, "emergency", {"squawk": squawk})

        on_ground_state[registration] = plane_data.get("on_ground", False)

    planes_to_remove = []
    for plane in active_planes - currently_flying:
        if plane in last_seen:
            time_since_seen = current_timestamp - last_seen[plane]
            if time_since_seen < LANDING_GRACE_PERIOD:
                print(f"  {plane} no detectado, pero dentro del período de gracia ({int(time_since_seen)}s < {LANDING_GRACE_PERIOD}s)")
                currently_flying.add(plane)
                continue

        icao24 = next((k for k, v in PLANES.items() if v == plane), None)
        msg = f"🛬 {plane} aterrizó\n🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        notify_telegram(msg)
        if icao24:
            save_flight_event(icao24, "landing")
        planes_to_remove.append(plane)

    for plane in planes_to_remove:
        notified_planes.discard(plane)
        last_seen.pop(plane, None)

    active_planes = currently_flying
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - Verificación completada. Aviones en vuelo: {len(currently_flying)}")
    return planes_info


def monitor_flights():
    while True:
        check_flights()
        time.sleep(25)


@app.route('/')
def index():
    html = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor de Vuelos Privados</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .plane { background: #f0f0f0; padding: 15px; margin: 10px 0; border-radius: 8px; }
        .flying { background: #e7f5e7; border-left: 4px solid #28a745; }
        .status { font-weight: bold; color: #28a745; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
        button:hover { background: #0056b3; }
        .timestamp { color: #666; font-size: 0.9em; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background: white; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #007bff; color: white; font-weight: bold; }
        tr:hover { background: #f5f5f5; }
        .takeoff { color: #28a745; font-weight: bold; }
        .landing { color: #dc3545; font-weight: bold; }
        .section { margin: 30px 0; }
        h2 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    </style>
</head>
<body>
    <h1>🛩️ Monitor de Vuelos Privados</h1>
    <p>Monitoreo en tiempo real de las matrículas: LV-FVZ, LV-CCO, LV-FUF, LV-KMA, LV-KAX</p>
    <p style="font-size: 0.85em; color: #666;">Multi-fuente: ADSB.one + OpenSky Network | Detección vía ICAO24 Mode-S</p>

    <div>
        <button onclick="checkFlights()">🔄 Verificar Vuelos</button>
        <button onclick="loadHistory()">📋 Ver Historial</button>
    </div>

    <div id="status"></div>
    <div class="section" id="results"></div>

    <div class="section" id="history-section" style="display: none;">
        <h2>📊 Historial de Vuelos</h2>
        <div id="history"></div>
    </div>

    <script>
        async function checkFlights() {
            document.getElementById('status').innerHTML = '<p>🔍 Consultando API...</p>';
            try {
                const response = await fetch('/api/check');
                const data = await response.json();
                document.getElementById('status').innerHTML = `<p class="timestamp">Última verificación: ${data.timestamp}</p>`;
                const resultsDiv = document.getElementById('results');
                if (data.planes_en_vuelo > 0) {
                    let html = `<h2>✈️ Aviones en vuelo (${data.planes_en_vuelo})</h2>`;
                    data.aviones.forEach(plane => {
                        html += `<div class="plane flying">
                            <div class="status">🟢 ${plane.callsign} EN VUELO</div>
                            <p>Altitud: ${plane.altitude} | Velocidad: ${plane.velocity} km/h</p>
                            <p>Posición: ${plane.lat}, ${plane.lon}</p>
                        </div>`;
                    });
                    resultsDiv.innerHTML = html;
                } else {
                    resultsDiv.innerHTML = `<h2>Estado Actual</h2>
                        <div class="plane">
                            <div class="status">🔴 Ningún avión en vuelo</div>
                            <p>No se detectaron vuelos activos para las matrículas monitoreadas.</p>
                        </div>`;
                }
            } catch (error) {
                document.getElementById('results').innerHTML = `
                    <div class="plane" style="background: #f8d7da; border-left: 4px solid #dc3545;">
                        <div style="color: #721c24;">❌ Error al consultar API</div>
                    </div>`;
            }
        }

        async function loadHistory() {
            const historySection = document.getElementById('history-section');
            historySection.style.display = 'block';
            document.getElementById('history').innerHTML = '<p>⏳ Cargando historial...</p>';
            try {
                const response = await fetch('/api/history');
                const data = await response.json();
                if (data.total === 0) {
                    document.getElementById('history').innerHTML = '<p>No hay eventos registrados aún.</p>';
                    return;
                }
                let html = `<table><thead><tr>
                    <th>Matrícula</th><th>Evento</th><th>Fecha y Hora</th><th>Detalles</th>
                </tr></thead><tbody>`;
                data.events.forEach(event => {
                    const date = new Date(event.timestamp);
                    const formattedDate = date.toLocaleString('es-AR');
                    const eventType = event.type === 'TAKEOFF' ? '✈️ Despegue' : event.type === 'LANDING' ? '🛬 Aterrizaje' : event.type;
                    const eventClass = event.type === 'TAKEOFF' ? 'takeoff' : 'landing';
                    let details = '';
                    if (event.data && event.data.altitude) {
                        details = `Alt: ${event.data.altitude}, Vel: ${event.data.velocity} km/h`;
                    }
                    html += `<tr>
                        <td><strong>${event.callsign}</strong></td>
                        <td class="${eventClass}">${eventType}</td>
                        <td>${formattedDate}</td>
                        <td>${details}</td>
                    </tr>`;
                });
                html += '</tbody></table>';
                document.getElementById('history').innerHTML = html;
            } catch (error) {
                document.getElementById('history').innerHTML = '<p style="color: #dc3545;">❌ Error al cargar el historial</p>';
            }
        }

        checkFlights();
        loadHistory();
    </script>
</body>
</html>
    '''
    return html


@app.route('/dashboard/snapshot')
def dashboard_snapshot():
    try:
        with get_db() as conn:
            return jsonify(get_snapshot(conn))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/forecast/24h')
def forecast_24h():
    try:
        with get_db() as conn:
            return jsonify(get_forecast(conn))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/replay/snapshot')
def replay_snapshot():
    ts_str = request.args.get('ts')
    if not ts_str:
        return jsonify({"error": "ts required"}), 400
    try:
        ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except ValueError:
        return jsonify({"error": "invalid ts"}), 400
    try:
        with get_db() as conn:
            return jsonify(get_snapshot_at(conn, ts))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/replay/range')
def replay_range():
    start_str = request.args.get('start')
    end_str   = request.args.get('end')
    step_s    = max(30, min(int(request.args.get('step_seconds', 60)), 3600))
    if not start_str or not end_str:
        return jsonify({"error": "start and end required"}), 400
    try:
        start_dt = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
        end_dt   = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
    except ValueError:
        return jsonify({"error": "invalid date format"}), 400
    if (end_dt - start_dt).total_seconds() > 86400:
        return jsonify({"error": "range exceeds 24 hours"}), 400
    aircraft_icao24 = request.args.get('aircraft_icao24') or None
    try:
        with get_db() as conn:
            return jsonify(get_replay_range(conn, start_dt, end_dt, step_s, aircraft_icao24))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _parse_analytics_params():
    def dt(s, end_of_day=False):
        if not s:
            return None
        # Ensure timezone-aware
        if 'T' in s or 'Z' in s:
            d = datetime.fromisoformat(s.replace('Z', '+00:00'))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        # Date-only string (YYYY-MM-DD from <input type="date">)
        d = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        if end_of_day:
            # Make end_date inclusive of the full selected day
            d = d + timedelta(days=1) - timedelta(microseconds=1)
        return d
    return dict(
        start_date    = dt(request.args.get('start_date')),
        end_date      = dt(request.args.get('end_date'), end_of_day=True),
        operator_name = request.args.get('operator_name'),
        watchlist_id  = request.args.get('watchlist_id'),
        aircraft_id   = request.args.get('aircraft_id'),
    )


@app.route('/analytics/monthly')
def analytics_monthly():
    try:
        with get_db() as conn:
            return jsonify(get_monthly_analytics(conn, **_parse_analytics_params()))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/analytics/top-destinations')
def analytics_top_destinations():
    try:
        with get_db() as conn:
            return jsonify(get_top_destinations(conn, **_parse_analytics_params()))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/check')
def api_check():
    planes_info = check_flights()
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "planes_monitoreados": PLANES,
        "planes_en_vuelo": len(planes_info),
        "aviones": planes_info
    })


@app.route('/api/history')
def api_history():
    history = load_history()
    return jsonify({
        "total": len(history),
        "events": history
    })


@app.route('/status')
def status():
    return jsonify({
        "status": "running",
        "service": "Flight Monitor v4.0 - Supabase",
        "planes_monitoreados": PLANES,
        "planes_activos": list(active_planes),
        "sources": ["ADSB.one (primary)", "OpenSky Network (backup)"],
        "timestamp": datetime.now().isoformat()
    })


@app.route('/test-telegram')
def test_telegram():
    try:
        notify_telegram(
            f"🧪 Test del sistema de monitoreo\n"
            f"✅ Sistema funcionando correctamente\n"
            f"📊 Planes monitoreados: {', '.join(PLANES.values())}\n"
            f"🕐 Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        return jsonify({"status": "success", "timestamp": datetime.now().isoformat()})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


monitor_started = False


def start_monitor_thread():
    global monitor_started
    if not monitor_started:
        monitor_thread = threading.Thread(target=monitor_flights, daemon=True)
        monitor_thread.start()
        monitor_started = True
        print("✅ Monitor automático iniciado en thread background")
    return None


try:
    with get_db() as conn:
        for tail, ts in get_last_seen_from_db(conn).items():
            last_seen[tail] = ts
    print(f"Initialized last_seen from DB: {list(last_seen.keys())}")
except Exception as e:
    print(f"Could not initialize last_seen from DB: {e}")

enable_monitor = os.getenv('ENABLE_MONITOR', 'false').lower() == 'true'

if enable_monitor:
    print("🚀 Iniciando monitor automático...")
    start_monitor_thread()
else:
    print("⚠️ Monitor automático deshabilitado. Configure ENABLE_MONITOR=true para activar")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
