import json
from datetime import timedelta


def get_snapshot(conn):
    with conn.cursor() as cur:

        # Latest position per aircraft (DISTINCT ON is index-friendly)
        cur.execute("""
            SELECT DISTINCT ON (p.aircraft_id)
                p.aircraft_id, p.ts, p.lat, p.lon,
                p.altitude, p.velocity, p.heading, p.on_ground, p.source,
                a.tail_number, a.icao24
            FROM positions p
            JOIN aircraft a ON a.id = p.aircraft_id
            ORDER BY p.aircraft_id, p.ts DESC
        """)
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
