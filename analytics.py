from datetime import datetime, timezone, timedelta


def _defaults(start_date, end_date):
    now = datetime.now(tz=timezone.utc)
    return start_date or now - timedelta(days=365), end_date or now


def _filters(start_date, end_date, operator_name, watchlist_id, aircraft_id):
    f = {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()}
    if operator_name: f["operator_name"] = operator_name
    if watchlist_id:  f["watchlist_id"]  = watchlist_id
    if aircraft_id:   f["aircraft_id"]   = aircraft_id
    return f


def get_monthly_analytics(conn, start_date=None, end_date=None,
                          operator_name=None, watchlist_id=None, aircraft_id=None):
    start_date, end_date = _defaults(start_date, end_date)
    filters_applied      = _filters(start_date, end_date, operator_name, watchlist_id, aircraft_id)

    extra       = " AND f.aircraft_id = (SELECT id FROM aircraft WHERE icao24 = %s)" if aircraft_id else ""
    base_params = [start_date, end_date] + ([aircraft_id] if aircraft_id else [])

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT
                TO_CHAR(DATE_TRUNC('month', f.departure_time), 'YYYY-MM') AS month,
                COUNT(*)                                                    AS takeoffs,
                COUNT(*) FILTER (WHERE f.arrival_time IS NOT NULL)         AS landings
            FROM flights f
            WHERE f.departure_time >= %s AND f.departure_time <= %s
              AND f.confidence_score > 0.3
              {extra}
            GROUP BY 1
            ORDER BY 1
        """, base_params)
        monthly_rows = cur.fetchall()

        cur.execute(f"""
            SELECT COUNT(DISTINCT f.aircraft_id) AS active_aircraft
            FROM flights f
            WHERE f.departure_time >= %s AND f.departure_time <= %s
              AND f.confidence_score > 0.3
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


def get_top_destinations(conn, start_date=None, end_date=None,
                         operator_name=None, watchlist_id=None, aircraft_id=None):
    start_date, end_date = _defaults(start_date, end_date)
    filters_applied      = _filters(start_date, end_date, operator_name, watchlist_id, aircraft_id)

    extra       = " AND f.aircraft_id = (SELECT id FROM aircraft WHERE icao24 = %s)" if aircraft_id else ""
    base_params = [start_date, end_date] + ([aircraft_id] if aircraft_id else [])

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT
                COALESCE(arr.iata, f.arrival_label_raw) AS airport,
                COALESCE(arr.name, f.arrival_label_raw) AS name,
                COUNT(*)                                 AS count
            FROM flights f
            LEFT JOIN airports arr ON arr.id = f.arrival_airport_id
            WHERE f.departure_time >= %s AND f.departure_time <= %s
              AND f.status = 'landed'
              AND f.arrival_label_raw IS NOT NULL
              AND f.arrival_label_raw <> 'UNKNOWN'
              {extra}
            GROUP BY 1, 2
            ORDER BY 3 DESC
            LIMIT 20
        """, base_params)
        rows = cur.fetchall()

    return {
        "filters_applied":  filters_applied,
        "top_destinations": [
            {
                "airport": r["airport"],
                "name":    r["name"] or r["airport"],
                "count":   int(r["count"]),
            }
            for r in rows
        ],
    }
