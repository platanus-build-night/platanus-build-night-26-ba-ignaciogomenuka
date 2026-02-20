# CLAUDE.md — Fleet Ops Dashboard

## 0. Goal

Build a Fleet Operations Dashboard that:

1. Tracks a watchlisted fleet of aircraft in near real-time.
2. Stores historical positions and flight events.
3. Displays a modern dashboard with:
   - Realtime fleet status
   - Event feed
   - Map with aircraft markers
   - Fleet demand forecast (next 24h)
4. Implements deterministic demand prediction logic.

This is NOT a consumer flight tracker.
This is an operations intelligence dashboard.

---

## 1. Product Scope (MVP)

### Must Have
- Watchlist of aircraft (by ICAO24 or tail)
- Worker that polls data source every 20–30 seconds
- Positions stored in database
- Derived events:
  - TAKEOFF
  - LANDING
  - APPEARED
  - EMERGENCY (7700/7600/7500)
- Dashboard page:
  - Fleet KPIs
  - Realtime event feed
  - Leaflet map
  - Forecast panel
- Deterministic 24h flight demand forecast

### Not in MVP
- Authentication
- Multi-user roles
- External integrations
- ML models
- Route prediction
- WebSockets (polling acceptable)

---

## 2. Architecture

### Backend
- FastAPI
- PostgreSQL
- Worker process for polling
- Modules:
  - models.py
  - worker.py
  - forecast.py
  - dashboard.py

### Frontend
- Next.js
- TailwindCSS
- Leaflet map
- Polling every 5–10 seconds

---

## 3. Database Schema (Minimum)

### aircraft
- id
- icao24 (unique)
- tail_number
- operator_name
- created_at

### positions
- id
- aircraft_id
- ts
- lat
- lon
- altitude
- velocity
- heading
- on_ground

### events
- id
- aircraft_id
- ts
- type (TAKEOFF, LANDING, APPEARED, EMERGENCY)
- meta (jsonb)

---

## 4. Event Derivation Rules

TAKEOFF:
- on_ground changed from true → false

LANDING:
- on_ground changed from false → true

APPEARED:
- aircraft seen after >2 hours of absence

EMERGENCY:
- squawk code 7700 / 7600 / 7500

Prevent duplicate events within 2 minutes.

---

## 5. Demand Forecast (Deterministic)

Use TAKEOFF events as proxy for flights.

### Calculation:

1. Compute hourly takeoff rate over last 30 days:
   group by hour-of-week (0–167)

2. Compute recency factor:
   recency_factor = (last 7 days takeoffs / last 30 days takeoffs)
   clamp between 0.5 and 1.5

3. For next 24 hours:
   expected_total = sum(hourly_rate * recency_factor)

4. Confidence interval (Poisson approx):
   CI = expected ± 1.96 * sqrt(expected)
   lower bound >= 0

Return:
- expected_total
- ci_low
- ci_high
- hourly_series[24]

No ML.
No LLM.
Pure deterministic logic.

---

## 6. API Endpoints

GET /dashboard/snapshot
Returns:
- fleet_kpis
- latest_positions
- last_50_events
- data_freshness_seconds

GET /forecast/24h
Returns:
- expected_total
- ci_low
- ci_high
- hourly_series

---

## 7. Frontend Requirements

Dashboard layout:

Left:
- Event feed (auto-refresh)

Center:
- Leaflet map
- Aircraft markers (rotate by heading)

Right:
- Forecast card
- Hourly bar chart

Bottom:
- Fleet table (filterable)

Polling:
- Snapshot: every 5 seconds
- Forecast: every 60 seconds

---

## 8. Token Efficiency Rules

Claude must:
- Modify only requested files.
- Not rewrite entire project.
- Avoid over-engineering.
- Avoid unnecessary abstractions.
- Avoid adding libraries unless requested.
- Ask at most one clarifying question.

When responding:
- Output only changed files.
- Keep explanations short.