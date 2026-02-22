import json
from datetime import timedelta
from airports import nearest_airport


def get_snapshot(conn):
    with conn.cursor() as cur:

        # All aircraft, with their latest position if available (LEFT JOIN)
        cur.execute("""
            SELECT DISTINCT ON (a.id)
                a.id AS aircraft_id, p.ts, p.lat, p.lon,
                p.altitude, p.velocity, p.heading,
                COALESCE(p.on_ground, true) AS on_ground,
                p.source, a.tail_number, a.icao24
            FROM aircraft a
            LEFT JOIN positions p ON p.aircraft_id = a.id
            ORDER BY a.id, p.ts DESC NULLS LAST
        """)
        raw_positions = cur.fetchall()
        latest_positions = []
        for r in raw_positions:
            on_ground = bool(r["on_ground"])
            location = None
            if on_ground and r["lat"] is not None and r["lon"] is not None:
                apt = nearest_airport(float(r["lat"]), float(r["lon"]), radius_km=80)
                if apt:
                    location = apt["iata"]
            latest_positions.append({
                "tail_number": r["tail_number"],
                "icao24": r["icao24"],
                "ts": r["ts"].isoformat() if r["ts"] else None,
                "lat": r["lat"],
                "lon": r["lon"],
                "altitude": r["altitude"],
                "velocity": r["velocity"],
                "heading": r["heading"],
                "on_ground": on_ground,
                "source": r["source"],
                "location": location,
            })

        # KPIs + freshness in one round-trip
        cur.execute("""
            SELECT
                (SELECT COUNT(DISTINCT aircraft_id)
                 FROM positions
                 WHERE ts > NOW() - INTERVAL '15 minutes') AS seen_last_15m,
                (SELECT COUNT(*)
                 FROM events
                 WHERE ts > NOW() - INTERVAL '1 hour') AS events_last_hour,
                (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(ts)))::int
                 FROM positions) AS freshness_seconds
        """)
        row = cur.fetchone()
        seen_last_15m = int(row["seen_last_15m"] or 0)
        total_fleet = 5

        fleet_kpis = {
            "in_air": seen_last_15m,
            "on_ground": total_fleet - seen_last_15m,
            "seen_last_15m": seen_last_15m,
            "events_last_hour": int(row["events_last_hour"] or 0),
        }
        freshness_seconds = int(row["freshness_seconds"] or 0)

        # Last 50 events
        cur.execute("""
            SELECT e.ts, e.type, e.meta, a.tail_number, a.icao24
            FROM events e
            JOIN aircraft a ON a.id = e.aircraft_id
            ORDER BY e.ts DESC
            LIMIT 50
        """)
        last_50_events = [
            {
                "ts": r["ts"].isoformat(),
                "type": r["type"],
                "tail_number": r["tail_number"],
                "icao24": r["icao24"],
                "meta": r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"] or "{}"),
            }
            for r in cur.fetchall()
        ]

    return {
        "fleet_kpis": fleet_kpis,
        "latest_positions": latest_positions,
        "last_50_events": last_50_events,
        "data_freshness_seconds": freshness_seconds,
    }


def has_recent_event(conn, aircraft_id, event_type):
    """True if same event type was recorded for this aircraft within the last 2 minutes."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM events
            WHERE aircraft_id = %s
              AND type = %s
              AND ts > NOW() - INTERVAL '2 minutes'
            LIMIT 1
        """, (aircraft_id, event_type))
        return cur.fetchone() is not None


def get_snapshot_at(conn, ts):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (p.aircraft_id)
                p.aircraft_id, p.ts, p.lat, p.lon,
                p.altitude, p.velocity, p.heading, p.on_ground, p.source,
                a.tail_number, a.icao24
            FROM positions p
            JOIN aircraft a ON a.id = p.aircraft_id
            WHERE p.ts <= %s
            ORDER BY p.aircraft_id, p.ts DESC
        """, (ts,))
        latest_positions = [
            {
                "tail_number": r["tail_number"],
                "icao24": r["icao24"],
                "ts": r["ts"].isoformat(),
                "lat": r["lat"],
                "lon": r["lon"],
                "altitude": r["altitude"],
                "velocity": r["velocity"],
                "heading": r["heading"],
                "on_ground": r["on_ground"],
                "source": r["source"],
            }
            for r in cur.fetchall()
        ]
        cur.execute("""
            SELECT
                (SELECT COUNT(DISTINCT aircraft_id) FROM positions
                 WHERE ts > %s - INTERVAL '15 minutes' AND ts <= %s) AS seen_last_15m,
                (SELECT COUNT(*) FROM events
                 WHERE ts > %s - INTERVAL '1 hour' AND ts <= %s) AS events_last_hour
        """, (ts, ts, ts, ts))
        row = cur.fetchone()
        seen_last_15m = int(row["seen_last_15m"] or 0)
        cur.execute("""
            SELECT e.ts, e.type, e.meta, a.tail_number, a.icao24
            FROM events e
            JOIN aircraft a ON a.id = e.aircraft_id
            WHERE e.ts <= %s
            ORDER BY e.ts DESC
            LIMIT 20
        """, (ts,))
        last_events = [
            {
                "ts": r["ts"].isoformat(),
                "type": r["type"],
                "tail_number": r["tail_number"],
                "icao24": r["icao24"],
                "meta": r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"] or "{}"),
            }
            for r in cur.fetchall()
        ]
    return {
        "fleet_kpis": {
            "in_air": seen_last_15m,
            "on_ground": 5 - seen_last_15m,
            "seen_last_15m": seen_last_15m,
            "events_last_hour": int(row["events_last_hour"] or 0),
        },
        "latest_positions": latest_positions,
        "last_50_events": last_events,
        "data_freshness_seconds": 0,
    }


def get_replay_range(conn, start_dt, end_dt, step_seconds, aircraft_icao24=None):
    buffer_start = start_dt - timedelta(hours=1)
    icao_filter  = " AND a.icao24 = %s" if aircraft_icao24 else ""
    pos_params   = [buffer_start, end_dt] + ([aircraft_icao24] if aircraft_icao24 else [])
    evt_params   = [buffer_start, end_dt] + ([aircraft_icao24] if aircraft_icao24 else [])

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT p.ts, p.aircraft_id, p.lat, p.lon, p.altitude, p.velocity,
                   p.heading, p.on_ground, p.source, a.tail_number, a.icao24
            FROM positions p
            JOIN aircraft a ON a.id = p.aircraft_id
            WHERE p.ts >= %s AND p.ts <= %s{icao_filter}
            ORDER BY p.aircraft_id, p.ts ASC
        """, pos_params)
        all_positions = cur.fetchall()

        cur.execute(f"""
            SELECT e.ts, e.type, e.meta, a.tail_number, a.icao24
            FROM events e
            JOIN aircraft a ON a.id = e.aircraft_id
            WHERE e.ts >= %s AND e.ts <= %s{icao_filter}
            ORDER BY e.ts ASC
        """, evt_params)
        all_events = cur.fetchall()

    steps = []
    current = start_dt
    while current <= end_dt:
        seen = {}
        for row in all_positions:
            if row["ts"] <= current:
                seen[row["aircraft_id"]] = row

        cutoff_15m = current - timedelta(minutes=15)
        cutoff_1h  = current - timedelta(hours=1)
        seen_15m   = len({r["aircraft_id"] for r in all_positions if cutoff_15m <= r["ts"] <= current})
        events_1h  = sum(1 for e in all_events if cutoff_1h <= e["ts"] <= current)

        events_at = [
            {
                "ts": e["ts"].isoformat(),
                "type": e["type"],
                "tail_number": e["tail_number"],
                "icao24": e["icao24"],
                "meta": e["meta"] if isinstance(e["meta"], dict) else json.loads(e["meta"] or "{}"),
            }
            for e in all_events if e["ts"] <= current
        ][-20:]

        steps.append({
            "ts": current.isoformat(),
            "fleet_kpis": {
                "in_air": seen_15m,
                "on_ground": 5 - seen_15m,
                "seen_last_15m": seen_15m,
                "events_last_hour": events_1h,
            },
            "latest_positions": [
                {
                    "tail_number": r["tail_number"],
                    "icao24": r["icao24"],
                    "ts": r["ts"].isoformat(),
                    "lat": r["lat"],
                    "lon": r["lon"],
                    "altitude": r["altitude"],
                    "velocity": r["velocity"],
                    "heading": r["heading"],
                    "on_ground": r["on_ground"],
                    "source": r["source"],
                }
                for r in seen.values()
            ],
            "last_50_events": list(reversed(events_at)),
        })
        current += timedelta(seconds=step_seconds)
    return steps


def get_flight_board(conn, limit=40, icao24=None):
    """Return last N flights (TAKEOFF + matching LANDING) with origin/destination airports."""
    icao_filter = " AND a.icao24 = %s" if icao24 else ""
    params = ([icao24] if icao24 else []) + [limit]

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT
                t.ts                                       AS takeoff_ts,
                l.ts                                       AS landing_ts,
                a.tail_number,
                a.icao24,
                COALESCE(t.meta->>'origin_airport', '—')  AS origin,
                COALESCE(t.meta->>'origin_name',    '—')  AS origin_name,
                COALESCE(l.meta->>'destination_airport','—') AS destination,
                COALESCE(l.meta->>'destination_name',    '—') AS destination_name,
                (t.meta->>'velocity')::float               AS velocity_kmh,
                (t.meta->>'altitude')::float               AS cruise_alt,
                t.meta->>'source'                          AS source
            FROM events t
            JOIN aircraft a ON a.id = t.aircraft_id
            LEFT JOIN LATERAL (
                SELECT l2.ts, l2.meta FROM events l2
                WHERE l2.aircraft_id = t.aircraft_id
                  AND l2.type = 'LANDING'
                  AND l2.ts > t.ts
                  AND l2.ts < t.ts + INTERVAL '16 hours'
                ORDER BY l2.ts ASC LIMIT 1
            ) l ON true
            WHERE t.type = 'TAKEOFF'
              AND (t.meta->>'velocity')::float > 80
              {icao_filter}
            ORDER BY t.ts DESC
            LIMIT %s
        """, params)
        rows = cur.fetchall()

    flights = []
    for r in rows:
        dur_s = None
        if r["landing_ts"] and r["takeoff_ts"]:
            dur_s = int((r["landing_ts"] - r["takeoff_ts"]).total_seconds())
        flights.append({
            "tail_number":      r["tail_number"],
            "icao24":           r["icao24"],
            "takeoff_ts":       r["takeoff_ts"].isoformat(),
            "landing_ts":       r["landing_ts"].isoformat() if r["landing_ts"] else None,
            "origin":           r["origin"],
            "origin_name":      r["origin_name"],
            "destination":      r["destination"],
            "destination_name": r["destination_name"],
            "duration_s":       dur_s,
            "velocity_kmh":     float(r["velocity_kmh"]) if r["velocity_kmh"] else None,
            "cruise_alt":       float(r["cruise_alt"])   if r["cruise_alt"]   else None,
        })
    return {"flights": flights}


def get_last_seen_from_db(conn):
    """Returns {tail_number: unix_timestamp} of the latest position per aircraft."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (p.aircraft_id)
                a.tail_number, p.ts
            FROM positions p
            JOIN aircraft a ON a.id = p.aircraft_id
            ORDER BY p.aircraft_id, p.ts DESC
        """)
        return {r["tail_number"]: r["ts"].timestamp() for r in cur.fetchall()}
