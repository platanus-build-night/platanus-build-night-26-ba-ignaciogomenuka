import json


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
