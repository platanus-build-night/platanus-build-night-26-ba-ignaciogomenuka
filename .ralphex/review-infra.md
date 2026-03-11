# Infrastructure Code Review — BairesRadar

## Objective
Perform a thorough infrastructure and backend code review of this project. Find bugs, logic errors, race conditions, security issues, performance problems, and any incorrect behavior. Fix every issue found directly in the source files.

## Scope
Review and fix bugs in all backend Python files:
- `app.py` — Flask app, monitor thread, routes, DB interactions
- `db.py` — snapshot queries, flight board, replay, connection handling
- `analytics.py` — monthly stats queries
- `forecast.py` — forecast logic
- `airports.py` — airport dataset, nearest_airport functions

Also review:
- `frontend/app/page.tsx` — React dashboard, polling logic, hardcoded values
- `frontend/app/components/FleetMap.tsx` — map component if it exists

## What to look for

### Backend (Python)
1. **DB connection leaks** — psycopg2 connections opened but not closed properly
2. **Race conditions** — shared mutable globals (`active_planes`, `last_seen`, `on_ground_state`, `notified_planes`) modified from both the monitor thread and Flask request threads without locking
3. **Logic bugs** — incorrect boolean logic, wrong comparisons, missed edge cases
4. **N+1 queries** — repeated DB calls inside loops
5. **Missing index hints** — queries that likely cause sequential scans
6. **Hardcoded fleet size** — any remaining `5` that should be `6`
7. **Type errors** — mixing string "N/A" with numeric comparisons
8. **Error swallowing** — bare `except Exception` that hides bugs
9. **Monitor thread robustness** — what happens if `check_flights()` throws; does the thread die silently?
10. **Timezone handling** — naive vs aware datetime mixing

### Frontend (TypeScript/React)
1. **Stale closures** in useEffect / useCallback
2. **Missing dependencies** in useEffect dependency arrays
3. **Memory leaks** — intervals or listeners not cleaned up
4. **Hardcoded fleet totals** — any remaining `4` or `5` that should be `5` (1 in air + 5 others)
5. **API error handling** — unhandled rejected promises

## Instructions
1. Read every file listed in scope completely before making changes
2. Fix each bug found directly in the file
3. After fixing, verify the fix is correct by re-reading the changed section
4. Do NOT refactor working code — only fix bugs
5. Do NOT add comments unless explaining a non-obvious fix
6. Report every bug found with file:line and description
