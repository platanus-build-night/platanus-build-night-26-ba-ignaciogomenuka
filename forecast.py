import math
from datetime import datetime, timedelta, timezone

ARGENTINA_TZ = timezone(timedelta(hours=-3))


def get_forecast(conn):
    with conn.cursor() as cur:

        # Hourly takeoff counts by hour-of-week (0..167) over last 30 days.
        # DOW: Sun=0, Mon=1..Sat=6 — matches Python isoweekday() % 7.
        cur.execute("""
            SELECT
                EXTRACT(DOW FROM departure_time AT TIME ZONE 'America/Argentina/Buenos_Aires')::int * 24
                + EXTRACT(HOUR FROM departure_time AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS how,
                COUNT(*) AS cnt
            FROM flights
            WHERE confidence_score > 0.3
              AND departure_time > NOW() - INTERVAL '30 days'
            GROUP BY how
        """)
        raw_counts = {int(r["how"]): int(r["cnt"]) for r in cur.fetchall()}

        # Recency factor — single query, two filtered aggregates.
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE departure_time > NOW() - INTERVAL '7 days')  AS last_7,
                COUNT(*) FILTER (WHERE departure_time > NOW() - INTERVAL '30 days') AS last_30
            FROM flights
            WHERE confidence_score > 0.3
        """)
        row = cur.fetchone()
        last_7  = int(row["last_7"]  or 0)
        last_30 = int(row["last_30"] or 0)

    recency_factor = (
        max(0.5, min(1.5, last_7 / last_30)) if last_30 > 0 else 1.0
    )

    weeks_in_window = 30.0 / 7.0
    hourly_rates = {how: cnt / weeks_in_window for how, cnt in raw_counts.items()}

    now = datetime.now(ARGENTINA_TZ)
    current_hour = now.replace(minute=0, second=0, microsecond=0)

    hourly_series = []
    for i in range(24):
        slot = current_hour + timedelta(hours=i)
        how = (slot.isoweekday() % 7) * 24 + slot.hour
        expected = hourly_rates.get(how, 0.0) * recency_factor
        hourly_series.append({
            "ts_hour_start": slot.isoformat(),
            "expected": round(expected, 4),
        })

    expected_total = sum(h["expected"] for h in hourly_series)
    margin = 1.96 * math.sqrt(expected_total) if expected_total > 0 else 0.0

    return {
        "expected_total": round(expected_total, 4),
        "ci_low":         round(max(0.0, expected_total - margin), 4),
        "ci_high":        round(expected_total + margin, 4),
        "hourly_series":  hourly_series,
    }
