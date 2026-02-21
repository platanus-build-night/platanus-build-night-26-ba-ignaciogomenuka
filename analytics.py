from datetime import datetime, timezone, timedelta


def get_monthly_analytics(conn, start_date=None, end_date=None,
                          operator_name=None, watchlist_id=None, aircraft_id=None):
    now = datetime.now(tz=timezone.utc)
    if end_date is None:
        end_date = now
    if start_date is None:
        start_date = now - timedelta(days=365)

    filters_applied = {
        "start_date": start_date.isoformat(),
        "end_date":   end_date.isoformat(),
    }
    if operator_name:
        filters_applied["operator_name"] = operator_name
    if watchlist_id:
        filters_applied["watchlist_id"] = watchlist_id
    if aircraft_id:
        filters_applied["aircraft_id"] = aircraft_id

    # Build optional WHERE clause — only aircraft_id maps to current schema
    extra = " AND e.aircraft_id = %s" if aircraft_id else ""
    base_params = [start_date, end_date] + ([aircraft_id] if aircraft_id else [])

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT
                TO_CHAR(DATE_TRUNC('month', e.ts), 'YYYY-MM') AS month,
                COUNT(*) FILTER (WHERE e.type = 'TAKEOFF') AS takeoffs,
                COUNT(*) FILTER (WHERE e.type = 'LANDING') AS landings
            FROM events e
            WHERE e.ts >= %s AND e.ts <= %s
              AND e.type IN ('TAKEOFF', 'LANDING')
              {extra}
            GROUP BY 1
            ORDER BY 1
        """, base_params)
        monthly_rows = cur.fetchall()

        cur.execute(f"""
            SELECT COUNT(DISTINCT e.aircraft_id) AS active_aircraft
            FROM events e
            WHERE e.ts >= %s AND e.ts <= %s
              AND e.type = 'TAKEOFF'
              {extra}
        """, base_params)
        active_row = cur.fetchone()

    monthly_series = [
        {
            "month":    r["month"],
            "flights":  int(r["takeoffs"]),
            "takeoffs": int(r["takeoffs"]),
            "landings": int(r["landings"]),
        }
        for r in monthly_rows
    ]

    total_takeoffs = sum(r["takeoffs"] for r in monthly_series)
    total_landings = sum(r["landings"] for r in monthly_series)

    return {
        "filters_applied": filters_applied,
        "kpis": {
            "total_flights":   total_takeoffs,
            "takeoffs":        total_takeoffs,
            "landings":        total_landings,
            "active_aircraft": int(active_row["active_aircraft"] or 0),
        },
        "monthly_series": monthly_series,
    }
