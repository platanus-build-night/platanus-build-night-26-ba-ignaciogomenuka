import json
from datetime import timedelta
from collections import defaultdict


# =============================================================================
# Airport helpers — DB-backed, replaces airports.py for all runtime lookups
# =============================================================================

def nearest_airport_db(cur, lat, lon, radius_km=50, on_ground=False):
    """Return nearest airport within radius_km, or None.
    Uses 150 km radius when on_ground to cover remote strips with weak ADS-B."""
    if lat is None or lon is None:
        return None
    limit_km = 150.0 if on_ground else float(radius_km)
    cur.execute("""
        SELECT iata, name, lat, lon,
               (6371 * acos(LEAST(1.0,
                   cos(radians(%s)) * cos(radians(lat)) * cos(radians(lon) - radians(%s))
                   + sin(radians(%s)) * sin(radians(lat))
               ))) AS dist_km
        FROM airports
        ORDER BY dist_km ASC
        LIMIT 1
    """, (lat, lon, lat))
    row = cur.fetchone()
    if row and float(row["dist_km"]) <= limit_km:
        return {
            "iata": row["iata"],
            "name": row["name"],
            "lat":  float(row["lat"]),
            "lon":  float(row["lon"]),
        }
    return None


def log_unknown_airport(cur, lat, lon, raw_label=None):
    """Upsert an unresolved coordinate into unknown_airport_candidates.
    Deduplicates by rounding to 2 decimal places (~1 km precision)."""
    if lat is None or lon is None:
        return
    cur.execute("""
        INSERT INTO unknown_airport_candidates (raw_label, normalized_label, lat, lon)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (round(lat::numeric, 2), round(lon::numeric, 2))
        DO UPDATE SET
            last_seen_at = NOW(),
            seen_count   = unknown_airport_candidates.seen_count + 1,
            raw_label    = EXCLUDED.raw_label
    """, (
        raw_label,
        (raw_label or "").strip().upper(),
        round(float(lat), 2),
        round(float(lon), 2),
    ))


# =============================================================================
# Flights table sync — keeps flights table live alongside events
# =============================================================================

def _airport_id(cur, iata):
    if not iata or iata == "UNKNOWN":
        return None
    cur.execute("SELECT id FROM airports WHERE iata = %s LIMIT 1", (iata,))
    row = cur.fetchone()
    return row["id"] if row else None


def sync_takeoff_to_flights(cur, aircraft_id, departure_time, origin_iata, source=None):
    """Insert an in_flight row on TAKEOFF. No-op if row already exists."""
    dep_id = _airport_id(cur, origin_iata)
    cur.execute("""
        INSERT INTO flights
            (aircraft_id, departure_time, departure_label_raw, departure_airport_id,
             status, tracking_mode, confidence_score, source, reason_code)
        VALUES (%s, %s, %s, %s, 'in_flight', 'event_derived', 0.5, %s, 'takeoff_event')
        ON CONFLICT (aircraft_id, departure_time) DO NOTHING
    """, (aircraft_id, departure_time, origin_iata, dep_id, source))


def sync_landing_to_flights(cur, aircraft_id, arrival_time, dest_iata, source=None):
    """Update the latest in_flight row to landed on LANDING event."""
    arr_id = _airport_id(cur, dest_iata)
    cur.execute("""
        UPDATE flights SET
            arrival_time       = %s,
            arrival_label_raw  = %s,
            arrival_airport_id = %s,
            status             = 'landed',
            confidence_score   = CASE
                WHEN departure_airport_id IS NOT NULL AND %s IS NOT NULL THEN 0.9
                ELSE 0.7
            END
        WHERE id = (
            SELECT id FROM flights
            WHERE aircraft_id = %s
              AND status = 'in_flight'
              AND departure_time > %s - INTERVAL '16 hours'
            ORDER BY departure_time DESC
            LIMIT 1
        )
    """, (arrival_time, dest_iata, arr_id, arr_id, aircraft_id, arrival_time))


# =============================================================================
# Snapshot (live fleet state)
# =============================================================================

def get_snapshot(conn):
    from datetime import datetime, timezone as tz
    STALE_HOURS = 2.0   # no signal for 2 h → assume landed

    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (a.id)
                a.id AS aircraft_id, p.ts, p.lat, p.lon,
                p.altitude, p.velocity, p.heading,
                COALESCE(p.on_ground, true) AS on_ground,
                p.source, a.tail_number, a.icao24,
                apt.iata AS location,
                apt.lat  AS airport_lat,
                apt.lon  AS airport_lon
            FROM aircraft a
            LEFT JOIN positions p ON p.aircraft_id = a.id
            LEFT JOIN LATERAL (
                SELECT apt2.iata, apt2.lat, apt2.lon,
                       (6371 * acos(LEAST(1.0,
                           cos(radians(p.lat)) * cos(radians(apt2.lat))
                           * cos(radians(apt2.lon) - radians(p.lon))
                           + sin(radians(p.lat)) * sin(radians(apt2.lat))
                       ))) AS dist_km
                FROM airports apt2
                WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
                ORDER BY dist_km ASC
                LIMIT 1
            ) apt ON apt.dist_km <= CASE WHEN COALESCE(p.on_ground, true) THEN 150.0 ELSE 50.0 END
            ORDER BY a.id, p.ts DESC NULLS LAST
        """)
        raw_pos_rows = cur.fetchall()

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
        kpi_row = cur.fetchone()
        seen_last_15m = int(kpi_row["seen_last_15m"] or 0)

        cur.execute("""
            SELECT e.ts, e.type, e.meta, a.tail_number, a.icao24
            FROM events e
            JOIN aircraft a ON a.id = e.aircraft_id
            ORDER BY e.ts DESC
            LIMIT 50
        """)
        last_50_events = [
            {
                "ts":          r["ts"].isoformat(),
                "type":        r["type"],
                "tail_number": r["tail_number"],
                "icao24":      r["icao24"],
                "meta":        r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"] or "{}"),
            }
            for r in cur.fetchall()
        ]

    # --- Stale-state correction -------------------------------------------
    now_utc = datetime.now(tz.utc)
    latest_positions = []
    stale_map = {}  # aircraft_id → pos_dict (was airborne, now assumed landed)

    for r in raw_pos_rows:
        ts_dt    = r["ts"]
        on_ground = bool(r["on_ground"])
        stale_h   = None

        if ts_dt is not None:
            if ts_dt.tzinfo is None:
                ts_dt = ts_dt.replace(tzinfo=tz.utc)
            age_h = (now_utc - ts_dt).total_seconds() / 3600.0
            if age_h >= STALE_HOURS:
                stale_h = round(age_h, 1)
                if not on_ground:
                    on_ground = True  # signal lost → assume landed

        pos = {
            "tail_number": r["tail_number"],
            "icao24":      r["icao24"],
            "ts":          r["ts"].isoformat() if r["ts"] else None,
            "lat":         r["lat"],
            "lon":         r["lon"],
            "altitude":    r["altitude"],
            "velocity":    r["velocity"],
            "heading":     r["heading"],
            "on_ground":   on_ground,
            "source":      r["source"],
            "location":    r["location"],
            "airport_lat": r["airport_lat"],
            "airport_lon": r["airport_lon"],
            "stale_hours": stale_h,
        }

        # Was airborne in DB but now forced on_ground → try to find last landing
        if stale_h is not None and not bool(r["on_ground"]) and r["aircraft_id"] is not None:
            stale_map[r["aircraft_id"]] = pos

        latest_positions.append(pos)

    # Resolve last-known landing airport for stale airborne aircraft
    if stale_map:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ON (f.aircraft_id)
                    f.aircraft_id,
                    arr.iata AS location,
                    arr.lat  AS airport_lat,
                    arr.lon  AS airport_lon
                FROM flights f
                JOIN airports arr ON arr.id = f.arrival_airport_id
                WHERE f.aircraft_id = ANY(%s) AND f.status = 'landed'
                ORDER BY f.aircraft_id, f.arrival_time DESC
            """, (list(stale_map.keys()),))
            for row in cur.fetchall():
                pos = stale_map.get(row["aircraft_id"])
                if pos:
                    pos["location"]    = row["location"]
                    pos["airport_lat"] = row["airport_lat"]
                    pos["airport_lon"] = row["airport_lon"]

    return {
        "fleet_kpis": {
            "in_air":           seen_last_15m,
            "on_ground":        6 - seen_last_15m,
            "seen_last_15m":    seen_last_15m,
            "events_last_hour": int(kpi_row["events_last_hour"] or 0),
        },
        "latest_positions":       latest_positions,
        "last_50_events":         last_50_events,
        "data_freshness_seconds": int(kpi_row["freshness_seconds"] or 0),
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
                a.tail_number, a.icao24,
                apt.iata AS location,
                apt.lat  AS airport_lat,
                apt.lon  AS airport_lon
            FROM positions p
            JOIN aircraft a ON a.id = p.aircraft_id
            LEFT JOIN LATERAL (
                SELECT apt2.iata, apt2.lat, apt2.lon,
                       (6371 * acos(LEAST(1.0,
                           cos(radians(p.lat)) * cos(radians(apt2.lat))
                           * cos(radians(apt2.lon) - radians(p.lon))
                           + sin(radians(p.lat)) * sin(radians(apt2.lat))
                       ))) AS dist_km
                FROM airports apt2
                WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
                ORDER BY dist_km ASC
                LIMIT 1
            ) apt ON apt.dist_km <= CASE WHEN COALESCE(p.on_ground, false) THEN 150.0 ELSE 50.0 END
            WHERE p.ts <= %s
            ORDER BY p.aircraft_id, p.ts DESC
        """, (ts,))
        latest_positions = [
            {
                "tail_number": r["tail_number"],
                "icao24":      r["icao24"],
                "ts":          r["ts"].isoformat(),
                "lat":         r["lat"],
                "lon":         r["lon"],
                "altitude":    r["altitude"],
                "velocity":    r["velocity"],
                "heading":     r["heading"],
                "on_ground":   bool(r["on_ground"]),
                "source":      r["source"],
                "location":    r["location"],
                "airport_lat": r["airport_lat"],
                "airport_lon": r["airport_lon"],
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
                "ts":          r["ts"].isoformat(),
                "type":        r["type"],
                "tail_number": r["tail_number"],
                "icao24":      r["icao24"],
                "meta":        r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"] or "{}"),
            }
            for r in cur.fetchall()
        ]
    return {
        "fleet_kpis": {
            "in_air":           seen_last_15m,
            "on_ground":        6 - seen_last_15m,
            "seen_last_15m":    seen_last_15m,
            "events_last_hour": int(row["events_last_hour"] or 0),
        },
        "latest_positions":       latest_positions,
        "last_50_events":         last_events,
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
                "ts":          e["ts"].isoformat(),
                "type":        e["type"],
                "tail_number": e["tail_number"],
                "icao24":      e["icao24"],
                "meta":        e["meta"] if isinstance(e["meta"], dict) else json.loads(e["meta"] or "{}"),
            }
            for e in all_events if e["ts"] <= current
        ][-20:]

        steps.append({
            "ts": current.isoformat(),
            "fleet_kpis": {
                "in_air":           seen_15m,
                "on_ground":        6 - seen_15m,
                "seen_last_15m":    seen_15m,
                "events_last_hour": events_1h,
            },
            "latest_positions": [
                {
                    "tail_number": r["tail_number"],
                    "icao24":      r["icao24"],
                    "ts":          r["ts"].isoformat(),
                    "lat":         r["lat"],
                    "lon":         r["lon"],
                    "altitude":    r["altitude"],
                    "velocity":    r["velocity"],
                    "heading":     r["heading"],
                    "on_ground":   r["on_ground"],
                    "source":      r["source"],
                }
                for r in seen.values()
            ],
            "last_50_events": list(reversed(events_at)),
        })
        current += timedelta(seconds=step_seconds)
    return steps


# =============================================================================
# Flight board — queries flights table (pre-materialised from events)
# =============================================================================

def get_flight_board(conn, limit=40, icao24=None):
    icao_filter = " AND a.icao24 = %s" if icao24 else ""
    params = ([icao24] if icao24 else []) + [limit]

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT
                f.departure_time                                     AS takeoff_ts,
                f.aircraft_id,
                f.arrival_time                                       AS landing_ts,
                a.tail_number,
                a.icao24,
                COALESCE(dep.iata, f.departure_label_raw, '—')      AS origin,
                COALESCE(dep.name, f.departure_label_raw, '—')      AS origin_name,
                COALESCE(arr.iata, f.arrival_label_raw,  '—')       AS destination,
                COALESCE(arr.name, f.arrival_label_raw,  '—')       AS destination_name,
                evt.velocity_kmh,
                evt.cruise_alt,
                f.source
            FROM flights f
            JOIN aircraft a ON a.id = f.aircraft_id
            LEFT JOIN airports dep ON dep.id = f.departure_airport_id
            LEFT JOIN airports arr ON arr.id = f.arrival_airport_id
            LEFT JOIN LATERAL (
                SELECT
                    CASE WHEN e.meta->>'velocity' ~ '^[0-9]+([.][0-9]+)?$'
                         THEN (e.meta->>'velocity')::float END AS velocity_kmh,
                    CASE WHEN e.meta->>'altitude' ~ '^[0-9]+([.][0-9]+)?$'
                         THEN (e.meta->>'altitude')::float END AS cruise_alt
                FROM events e
                WHERE e.aircraft_id = f.aircraft_id
                  AND e.type = 'TAKEOFF'
                  AND e.ts = f.departure_time
                LIMIT 1
            ) evt ON true
            WHERE f.confidence_score > 0.3
            {icao_filter}
            ORDER BY f.departure_time DESC
            LIMIT %s
        """, params)
        rows = cur.fetchall()

    if not rows:
        return {"flights": []}

    pos_by_aircraft: dict = defaultdict(list)
    try:
        aircraft_ids = list({r["aircraft_id"] for r in rows})
        min_ts = min(r["takeoff_ts"] for r in rows)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT aircraft_id, ts FROM positions"
                " WHERE aircraft_id = ANY(%s) AND ts >= %s AND lat IS NOT NULL",
                (aircraft_ids, min_ts),
            )
            for p in cur.fetchall():
                pos_by_aircraft[p["aircraft_id"]].append(p["ts"])
    except Exception as e:
        print(f"[flight_board] track count fetch failed (non-fatal): {e}")

    flights_out = []
    for r in rows:
        dur_s = None
        if r["landing_ts"] and r["takeoff_ts"]:
            dur_s = int((r["landing_ts"] - r["takeoff_ts"]).total_seconds())
        end_ts = r["landing_ts"] or (r["takeoff_ts"] + timedelta(hours=16))
        track_pts = sum(
            1 for ts in pos_by_aircraft[r["aircraft_id"]]
            if r["takeoff_ts"] <= ts <= end_ts
        )
        flights_out.append({
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
            "track_points":     track_pts,
        })
    return {"flights": flights_out}


def get_flight_track(conn, icao24, takeoff_ts, landing_ts=None):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT p.ts, p.lat, p.lon, p.altitude, p.velocity, p.heading, p.on_ground
            FROM positions p
            JOIN aircraft a ON a.id = p.aircraft_id
            WHERE a.icao24 = %s
              AND p.ts >= %s
              AND p.ts <= COALESCE(%s, NOW())
              AND p.lat IS NOT NULL AND p.lon IS NOT NULL
            ORDER BY p.ts ASC
        """, (icao24, takeoff_ts, landing_ts))
        return [
            {
                "ts":        r["ts"].isoformat(),
                "lat":       float(r["lat"]),
                "lon":       float(r["lon"]),
                "altitude":  r["altitude"],
                "velocity":  r["velocity"],
                "heading":   r["heading"],
                "on_ground": bool(r["on_ground"]),
            }
            for r in cur.fetchall()
        ]


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


# =============================================================================
# Maintenance jobs
# =============================================================================

def cleanup_stale_flights(conn):
    """Mark in_flight rows older than 24 h as incomplete (missed landing detection).
    Returns count of rows updated."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE flights
            SET status = 'incomplete'
            WHERE status = 'in_flight'
              AND departure_time < NOW() - INTERVAL '24 hours'
        """)
        return cur.rowcount


def promote_unknown_airports(conn, min_seen=3):
    """Flag candidates seen >= min_seen times as ready for human review.
    Returns count of rows promoted."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE unknown_airport_candidates
            SET status = 'review'
            WHERE status = 'pending'
              AND seen_count >= %s
        """, (min_seen,))
        return cur.rowcount


def get_unknown_airport_candidates(conn, status='pending', limit=50):
    """Return unknown airport candidates ordered by frequency."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, raw_label, normalized_label, lat, lon,
                   first_seen_at, last_seen_at, seen_count, status,
                   confidence_score, notes
            FROM unknown_airport_candidates
            WHERE status = %s
            ORDER BY seen_count DESC, last_seen_at DESC
            LIMIT %s
        """, (status, limit))
        rows = cur.fetchall()
    return [
        {
            "id":               r["id"],
            "raw_label":        r["raw_label"],
            "normalized_label": r["normalized_label"],
            "lat":              r["lat"],
            "lon":              r["lon"],
            "first_seen_at":    r["first_seen_at"].isoformat(),
            "last_seen_at":     r["last_seen_at"].isoformat(),
            "seen_count":       r["seen_count"],
            "status":           r["status"],
            "confidence_score": r["confidence_score"],
            "notes":            r["notes"],
        }
        for r in rows
    ]
