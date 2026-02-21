'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';

const FleetMap = dynamic(() => import('./components/FleetMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-gray-900 flex items-center justify-center text-gray-600 text-sm">Loading map…</div>,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface Position {
  tail_number: string;
  icao24: string;
  ts: string;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  on_ground: boolean;
  source: string;
}

interface FleetEvent {
  ts: string;
  type: string;
  tail_number: string;
  icao24: string;
  meta: Record<string, unknown>;
}

interface FleetKpis {
  in_air: number;
  on_ground: number;
  seen_last_15m: number;
  events_last_hour: number;
}

interface Snapshot {
  fleet_kpis: FleetKpis;
  latest_positions: Position[];
  last_50_events: FleetEvent[];
  data_freshness_seconds: number;
}

interface HourlyEntry {
  ts_hour_start: string;
  expected: number;
}

interface Forecast {
  expected_total: number;
  ci_low: number;
  ci_high: number;
  hourly_series: HourlyEntry[];
}

interface ReplayStep {
  ts: string;
  fleet_kpis: FleetKpis;
  latest_positions: Position[];
  last_50_events: FleetEvent[];
}

interface MonthlySeries {
  month: string;
  flights: number;
  takeoffs: number;
  landings: number;
}

interface MonthlyData {
  filters_applied: Record<string, string>;
  kpis: { total_flights: number; takeoffs: number; landings: number; active_aircraft: number };
  monthly_series: MonthlySeries[];
}

interface TopDest {
  airport: string;
  name: string;
  count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eventKey(ev: FleetEvent) {
  return `${ev.ts}|${ev.tail_number}|${ev.type}`;
}

const EVENT_STYLES: Record<string, string> = {
  TAKEOFF:     'bg-green-900/80 text-green-300 ring-1 ring-green-700',
  LANDING:     'bg-blue-900/80 text-blue-300 ring-1 ring-blue-700',
  APPEARED:    'bg-yellow-900/80 text-yellow-300 ring-1 ring-yellow-700',
  EMERGENCY:   'bg-red-900/80 text-red-300 ring-1 ring-red-700 animate-pulse',
  IN_PROGRESS: 'bg-gray-700 text-gray-300',
};

function eventBadge(type: string) {
  return EVENT_STYLES[type.toUpperCase()] ?? 'bg-gray-800 text-gray-400';
}

function relTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse bg-gray-800 rounded ${className}`} style={style} />;
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-xs shrink-0">
      <span>⚠ API unreachable — {msg}. Retrying…</span>
      <button onClick={onDismiss} className="ml-4 text-red-400 hover:text-red-200 transition-colors">✕</button>
    </div>
  );
}

function BarChart({ series }: { series: HourlyEntry[] }) {
  if (!series.length) return null;
  const max = Math.max(...series.map(h => h.expected), 0.01);
  const W = 240, H = 56;
  const bw = W / series.length;
  const nowHour = new Date().getHours();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      {series.map((h, i) => {
        const barH = Math.max(1, (h.expected / max) * (H - 4));
        const isCurrent = new Date(h.ts_hour_start).getHours() === nowHour;
        return (
          <rect
            key={i}
            x={i * bw + 1} y={H - barH}
            width={bw - 2} height={barH}
            fill={isCurrent ? '#93c5fd' : '#1d4ed8'}
            opacity={0.85} rx={1}
          />
        );
      })}
    </svg>
  );
}

const PLANES = [
  { icao24: 'e0659a', tail: 'LV-FVZ' },
  { icao24: 'e030cf', tail: 'LV-CCO' },
  { icao24: 'e06546', tail: 'LV-FUF' },
  { icao24: 'e0b341', tail: 'LV-KMA' },
  { icao24: 'e0b058', tail: 'LV-KAX' },
];

function MonthlyChart({ series }: { series: MonthlySeries[] }) {
  if (!series.length) return (
    <div className="flex items-center justify-center h-20 text-xs text-gray-600">No data for selected range</div>
  );
  const max = Math.max(...series.map(s => s.flights), 1);
  const W = 500, H = 72, labelH = 14;
  const bw = W / series.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + labelH}`} className="w-full" preserveAspectRatio="none">
      {series.map((s, i) => {
        const barH = Math.max(2, (s.flights / max) * H);
        const mo = new Date(s.month + '-02').toLocaleString('default', { month: 'short' });
        return (
          <g key={s.month}>
            <rect x={i * bw + 1} y={H - barH} width={bw - 2} height={barH}
              fill="#3b82f6" opacity={0.8} rx={1} />
            <text x={i * bw + bw / 2} y={H + labelH - 1}
              textAnchor="middle" fontSize={9} fill="#6b7280">{mo}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [snapshot, setSnapshot]       = useState<Snapshot | null>(null);
  const [forecast, setForecast]       = useState<Forecast | null>(null);
  const [freshness, setFreshness]     = useState(0);
  const [isLoading, setIsLoading]     = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatus]     = useState<'all' | 'in_air' | 'on_ground'>('all');
  const [newKeys, setNewKeys]         = useState<Set<string>>(new Set());

  // Replay state
  const [replayMode, setReplayMode]         = useState(false);
  const [replaySteps, setReplaySteps]       = useState<ReplayStep[]>([]);
  const [replayIdx, setReplayIdx]           = useState(0);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [playSpeed, setPlaySpeed]           = useState<1 | 4>(1);
  const [replayLoading, setReplayLoading]   = useState(false);
  const [replayAircraft, setReplayAircraft] = useState('');
  const [activeTab, setActiveTab]           = useState<'fleet' | 'analytics'>('fleet');

  // Monthly analytics state
  const today   = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const [mFilters, setMFilters]       = useState({ startDate: yearAgo, endDate: today, aircraft: '' });
  const [monthly, setMonthly]         = useState<MonthlyData | null>(null);
  const [mLoading, setMLoading]       = useState(false);
  const [topDest, setTopDest]         = useState<TopDest[]>([]);
  const [topDestLoading, setTopDestLoading] = useState(false);

  // Track which event keys have already been shown — don't highlight on first load
  const seenKeys    = useRef<Set<string>>(new Set());
  const isFirstFetch = useRef(true);

  const fetchSnapshot = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/dashboard/snapshot');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Snapshot = await res.json();

      // ── New-event detection ──
      if (isFirstFetch.current) {
        // Seed seen set silently on first load — nothing highlighted
        data.last_50_events.forEach(ev => seenKeys.current.add(eventKey(ev)));
        isFirstFetch.current = false;
      } else {
        const incoming = new Set<string>();
        data.last_50_events.forEach(ev => {
          const k = eventKey(ev);
          if (!seenKeys.current.has(k)) {
            incoming.add(k);
            seenKeys.current.add(k);
          }
        });
        if (incoming.size > 0) {
          setNewKeys(prev => new Set([...prev, ...incoming]));
          setTimeout(() => {
            setNewKeys(prev => {
              const next = new Set(prev);
              incoming.forEach(k => next.delete(k));
              return next;
            });
          }, 10_000);
        }
      }

      setSnapshot(data);
      setFreshness(data.data_freshness_seconds);
      setError(null);
      setIsLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const fetchForecast = useCallback(async () => {
    try {
      const res = await fetch('/forecast/24h');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForecast(await res.json());
    } catch { /* forecast errors don't block the dashboard */ }
  }, []);

  useEffect(() => {
    if (replayMode) return;
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, 5000);
    return () => clearInterval(id);
  }, [fetchSnapshot, replayMode]);

  useEffect(() => {
    fetchForecast();
    const id = setInterval(fetchForecast, 60_000);
    return () => clearInterval(id);
  }, [fetchForecast]);

  // Tick displayed freshness every second
  useEffect(() => {
    const id = setInterval(() => setFreshness(f => f + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Replay: advance index when playing
  useEffect(() => {
    if (!isPlaying || !replayMode) return;
    const id = setInterval(() => {
      setReplayIdx(i => {
        if (i >= replaySteps.length - 1) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, playSpeed === 4 ? 250 : 1000);
    return () => clearInterval(id);
  }, [isPlaying, replayMode, playSpeed, replaySteps.length]);

  async function toggleReplay() {
    if (replayMode) {
      setReplayMode(false);
      setIsPlaying(false);
      return;
    }
    setReplayLoading(true);
    try {
      const end   = new Date();
      const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
      const p     = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), step_seconds: '60' });
      if (replayAircraft) p.set('aircraft_icao24', replayAircraft);
      const res   = await fetch(`/replay/range?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const steps: ReplayStep[] = await res.json();
      setReplaySteps(steps);
      setReplayIdx(0);
      setReplayMode(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setReplayLoading(false);
    }
  }

  const fetchMonthly = useCallback(async (filters: typeof mFilters) => {
    setMLoading(true);
    try {
      const p = new URLSearchParams({ start_date: filters.startDate, end_date: filters.endDate });
      if (filters.aircraft) p.set('aircraft_id', filters.aircraft);
      const res = await fetch(`/analytics/monthly?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMonthly(await res.json());
    } catch { /* silent — monthly section shows empty state */ }
    finally { setMLoading(false); }
  }, []);

  useEffect(() => { fetchMonthly(mFilters); }, [fetchMonthly, mFilters]);

  const fetchTopDest = useCallback(async (filters: typeof mFilters) => {
    setTopDestLoading(true);
    try {
      const p = new URLSearchParams({ start_date: filters.startDate, end_date: filters.endDate });
      if (filters.aircraft) p.set('aircraft_id', filters.aircraft);
      const res = await fetch(`/analytics/top-destinations?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTopDest(data.top_destinations ?? []);
    } catch { /* silent */ }
    finally { setTopDestLoading(false); }
  }, []);

  useEffect(() => { fetchTopDest(mFilters); }, [fetchTopDest, mFilters]);

  const displaySnap = replayMode && replaySteps.length > 0 ? replaySteps[replayIdx] : snapshot;
  const kpis = displaySnap?.fleet_kpis;

  // Trail: accumulate positions of the selected aircraft through replay steps
  const trail = useMemo<[number, number][]>(() => {
    if (!replayMode || !replayAircraft || replaySteps.length === 0) return [];
    const pts: [number, number][] = [];
    for (let i = 0; i <= replayIdx && i < replaySteps.length; i++) {
      const pos = replaySteps[i].latest_positions.find(p => p.icao24 === replayAircraft);
      if (pos && pos.lat != null && pos.lon != null) pts.push([pos.lat, pos.lon]);
    }
    return pts;
  }, [replayMode, replayAircraft, replaySteps, replayIdx]);

  const filteredPositions = (displaySnap?.latest_positions ?? []).filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.tail_number.toLowerCase().includes(q) || p.icao24.toLowerCase().includes(q);
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'in_air'    && !p.on_ground) ||
      (statusFilter === 'on_ground' &&  p.on_ground);
    return matchSearch && matchStatus;
  });

  const mkpi = monthly?.kpis;

  return (
    <div className="bg-gray-950 text-gray-100">
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Error banner ── */}
      {error && <ErrorBanner msg={error} onDismiss={() => setError(null)} />}

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 h-12 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          {/* Refresh indicator dot */}
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
              error ? 'bg-red-500' : refreshing ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'
            }`} />
            <span className="font-bold text-white tracking-tight text-sm">BairesRadar</span>
          </div>
          {kpis ? (
            <div className="flex gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-green-900 text-green-300 font-medium">{kpis.in_air} in air</span>
              <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{kpis.on_ground} on ground</span>
              <span className="px-2 py-0.5 rounded-full bg-purple-900 text-purple-300">{kpis.seen_last_15m} seen/15m</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-900 text-blue-300">{kpis.events_last_hour} events/h</span>
            </div>
          ) : (
            isLoading && (
              <div className="flex gap-1.5">
                {[56, 64, 72, 56].map((w, i) => <Skeleton key={i} className={`h-5 w-${w / 4} rounded-full`} />)}
              </div>
            )
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {!replayMode && (
            <span className="text-gray-500">
              Data age: <span className={freshness > 60 ? 'text-yellow-400' : 'text-gray-400'}>{freshness}s</span>
            </span>
          )}
          <select
            value={replayAircraft}
            onChange={e => setReplayAircraft(e.target.value)}
            disabled={replayMode}
            className="bg-gray-800 text-gray-200 text-[11px] rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-700 disabled:opacity-40"
          >
            <option value="">All fleet</option>
            {PLANES.map(p => <option key={p.icao24} value={p.icao24}>{p.tail}</option>)}
          </select>
          <button
            onClick={toggleReplay}
            disabled={replayLoading}
            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              replayMode
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
            }`}
          >
            {replayLoading ? '⏳' : replayMode ? '📡 Live' : '⏪ Replay'}
          </button>
        </div>
      </header>

      {/* ── Replay controls bar ── */}
      {replayMode && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-indigo-950/80 border-b border-indigo-800 shrink-0 text-[11px]">
          <span className="text-indigo-400 font-bold shrink-0">REPLAY</span>
          {replayAircraft && (
            <span className="text-indigo-300 bg-indigo-900/60 px-1.5 py-0.5 rounded shrink-0">
              {PLANES.find(p => p.icao24 === replayAircraft)?.tail ?? replayAircraft}
            </span>
          )}
          <button
            onClick={() => setIsPlaying(p => !p)}
            className="px-2 py-0.5 rounded bg-indigo-800 hover:bg-indigo-700 text-white transition-colors"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => setPlaySpeed(s => s === 1 ? 4 : 1)}
            className="px-2 py-0.5 rounded bg-indigo-900 hover:bg-indigo-800 text-indigo-300 transition-colors"
          >
            {playSpeed}x
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, replaySteps.length - 1)}
            value={replayIdx}
            onChange={e => { setIsPlaying(false); setReplayIdx(+e.target.value); }}
            className="flex-1 accent-indigo-400"
          />
          <span className="text-indigo-300 whitespace-nowrap shrink-0 font-mono">
            {replaySteps[replayIdx] ? new Date(replaySteps[replayIdx].ts).toLocaleTimeString() : '—'}
          </span>
        </div>
      )}

      {/* ── Main row ── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: Event feed */}
        <aside className="w-60 shrink-0 flex flex-col border-r border-gray-800 bg-gray-900 overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800 shrink-0">
            Event Feed
          </div>

          {isLoading && Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5 border-b border-gray-800/50">
              <div className="flex justify-between mb-1.5">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-2 w-10" />
            </div>
          ))}

          {!isLoading && displaySnap?.last_50_events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="text-2xl mb-2 opacity-30">📋</div>
              <p className="text-xs text-gray-600">No events yet.<br />Events appear as aircraft are tracked.</p>
            </div>
          )}

          <div className="divide-y divide-gray-800/50">
            {displaySnap?.last_50_events.map(ev => {
              const k = eventKey(ev);
              const isNew = newKeys.has(k);
              return (
                <div
                  key={k}
                  className={`px-3 py-2 transition-all duration-500 ${
                    isNew
                      ? 'bg-blue-950/50 border-l-2 border-blue-500'
                      : 'hover:bg-gray-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5 gap-1">
                    <span className="font-semibold text-xs text-white truncate">{ev.tail_number}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase whitespace-nowrap ${eventBadge(ev.type)}`}>
                      {ev.type}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500">{relTime(ev.ts)}</div>
                  {isNew && <div className="text-[9px] text-blue-400 mt-0.5">● new</div>}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center: Map */}
        <div className="flex-1 relative">
          <FleetMap positions={displaySnap?.latest_positions ?? []} trail={trail.length > 1 ? trail : undefined} />
        </div>

        {/* Right: Forecast */}
        <aside className="w-60 shrink-0 flex flex-col border-l border-gray-800 bg-gray-900 overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800 shrink-0">
            24h Forecast
          </div>

          {isLoading && (
            <div className="p-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}
              </div>
              <Skeleton className="h-14" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          )}

          {!isLoading && !forecast && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="text-2xl mb-2 opacity-30">📊</div>
              <p className="text-xs text-gray-600">Forecast unavailable</p>
            </div>
          )}

          {forecast && (
            <div className="p-3 flex flex-col gap-3">
              {forecast.expected_total === 0 && (
                <div className="text-[10px] text-yellow-600 bg-yellow-900/20 border border-yellow-900/40 rounded px-2 py-1.5 leading-relaxed">
                  ⚠ Insufficient history. Forecast improves as flights accumulate.
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-base font-bold text-white">{forecast.expected_total.toFixed(1)}</div>
                  <div className="text-[9px] text-gray-500 mt-0.5">Expected</div>
                </div>
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-base font-bold text-green-400">{forecast.ci_low.toFixed(1)}</div>
                  <div className="text-[9px] text-gray-500 mt-0.5">CI Low</div>
                </div>
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-base font-bold text-blue-400">{forecast.ci_high.toFixed(1)}</div>
                  <div className="text-[9px] text-gray-500 mt-0.5">CI High</div>
                </div>
              </div>
              <div>
                <div className="text-[9px] text-gray-500 mb-1 uppercase tracking-wide">Hourly expected takeoffs</div>
                <BarChart series={forecast.hourly_series} />
                <div className="flex justify-between text-[9px] text-gray-600 mt-1">
                  <span>now</span><span>+12h</span><span>+24h</span>
                </div>
              </div>
              <div className="text-[9px] text-gray-600 pt-1 border-t border-gray-800">
                Poisson CI · deterministic · no ML
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Bottom Tabbed Panel ── */}
      <div className={`shrink-0 border-t border-gray-800 bg-gray-900 flex flex-col transition-[height] duration-300 ease-in-out ${
        activeTab === 'analytics' ? 'h-80' : 'h-44'
      }`}>

        {/* Tab bar */}
        <div className="flex items-center h-8 border-b border-gray-800 shrink-0">
          {(['fleet', 'analytics'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 px-3 h-full text-[11px] font-medium border-r border-gray-800 transition-colors ${
                activeTab === tab
                  ? 'text-white bg-gray-800/60 border-b-2 border-b-blue-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
              }`}
            >
              {tab === 'fleet' ? 'Fleet' : 'Analytics'}
            </button>
          ))}

          {/* Fleet controls */}
          {activeTab === 'fleet' && (
            <div className="flex items-center gap-2 px-3 ml-2 text-[11px]">
              <input
                type="text" placeholder="Search tail / ICAO…" value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 text-gray-200 text-[11px] rounded px-2 py-0.5 w-32 placeholder-gray-600 outline-none focus:ring-1 focus:ring-blue-700"
              />
              <select
                value={statusFilter} onChange={e => setStatus(e.target.value as typeof statusFilter)}
                className="bg-gray-800 text-gray-200 text-[11px] rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-blue-700"
              >
                <option value="all">All</option>
                <option value="in_air">In Air</option>
                <option value="on_ground">On Ground</option>
              </select>
              {!isLoading && <span className="text-gray-600">{filteredPositions.length} aircraft</span>}
            </div>
          )}

          {/* Analytics controls */}
          {activeTab === 'analytics' && (
            <div className="flex items-center gap-2 px-3 ml-2 text-[11px]">
              <label className="text-gray-500 shrink-0">From</label>
              <input type="date" value={mFilters.startDate}
                onChange={e => setMFilters(f => ({ ...f, startDate: e.target.value }))}
                className="bg-gray-800 text-gray-200 rounded px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-700" />
              <label className="text-gray-500 shrink-0">To</label>
              <input type="date" value={mFilters.endDate}
                onChange={e => setMFilters(f => ({ ...f, endDate: e.target.value }))}
                className="bg-gray-800 text-gray-200 rounded px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-700" />
              <select value={mFilters.aircraft} onChange={e => setMFilters(f => ({ ...f, aircraft: e.target.value }))}
                className="bg-gray-800 text-gray-200 text-[11px] rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-blue-700">
                <option value="">All aircraft</option>
                {PLANES.map(p => <option key={p.icao24} value={p.icao24}>{p.tail}</option>)}
              </select>
              {(mLoading || topDestLoading) && <span className="text-gray-600 animate-pulse">Loading…</span>}
            </div>
          )}
        </div>

        {/* ── Fleet content ── */}
        {activeTab === 'fleet' && (
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-sm z-10">
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  {['Tail', 'ICAO24', 'Status', 'Altitude', 'Speed', 'Heading', 'Source', 'Last seen'].map(h => (
                    <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {isLoading && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <Skeleton className="h-3" style={{ width: `${40 + (j * 13) % 40}px` }} />
                      </td>
                    ))}
                  </tr>
                ))}
                {!isLoading && filteredPositions.map(p => (
                  <tr key={p.icao24} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-3 py-1.5 font-semibold text-white">{p.tail_number}</td>
                    <td className="px-3 py-1.5 text-gray-400 font-mono">{p.icao24}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        p.on_ground ? 'bg-gray-700 text-gray-400' : 'bg-green-900/80 text-green-300 ring-1 ring-green-800'
                      }`}>
                        {p.on_ground ? 'Ground' : 'Air'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-300">{p.altitude != null ? `${Math.round(p.altitude)} ft` : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-300">{p.velocity != null ? `${Math.round(p.velocity)} km/h` : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-300">{p.heading != null ? `${Math.round(p.heading)}°` : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{p.source}</td>
                    <td className="px-3 py-1.5 text-gray-500">{relTime(p.ts)}</td>
                  </tr>
                ))}
                {!isLoading && filteredPositions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-gray-600 text-xs">
                      {search || statusFilter !== 'all' ? 'No aircraft match your filters.' : 'No aircraft positions recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Analytics content ── */}
        {activeTab === 'analytics' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">

            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {([
                { label: 'Total Flights',   value: mkpi?.total_flights,   color: 'text-white' },
                { label: 'Takeoffs',        value: mkpi?.takeoffs,        color: 'text-green-400' },
                { label: 'Landings',        value: mkpi?.landings,        color: 'text-blue-400' },
                { label: 'Active Aircraft', value: mkpi?.active_aircraft, color: 'text-purple-400' },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="bg-gray-800/60 rounded px-3 py-2 flex items-center gap-3">
                  {mLoading
                    ? <Skeleton className="h-5 w-10" />
                    : <span className={`text-lg font-bold ${color}`}>{value ?? '—'}</span>}
                  <span className="text-[9px] text-gray-500 uppercase tracking-wide leading-tight">{label}</span>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-2 gap-4">

              {/* Monthly chart */}
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-1">Flights per month</div>
                {mLoading
                  ? <Skeleton className="h-24 w-full" />
                  : <MonthlyChart series={monthly?.monthly_series ?? []} />}
              </div>

              {/* Top destinations */}
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-1">Top destinations</div>

                {topDestLoading && (
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                  </div>
                )}

                {!topDestLoading && topDest.length === 0 && (
                  <div className="text-xs text-gray-600 py-4 text-center">No destination data yet</div>
                )}

                {!topDestLoading && topDest.length > 0 && (() => {
                  const shown = topDest.slice(0, 8);
                  const maxCount = shown[0]?.count ?? 1;
                  const ordered = [...shown.filter(d => d.airport !== 'UNKNOWN'), ...shown.filter(d => d.airport === 'UNKNOWN')];
                  return (
                    <ol className="flex flex-col gap-1">
                      {ordered.map((d, i) => {
                        const isUnknown = d.airport === 'UNKNOWN';
                        const pct = Math.round((d.count / maxCount) * 100);
                        return (
                          <li key={d.airport} className="flex items-center gap-2 text-[11px]">
                            <span className={`w-4 text-right shrink-0 font-mono text-[10px] ${isUnknown ? 'text-gray-600' : 'text-gray-500'}`}>
                              {isUnknown ? '—' : i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <span className={`font-medium truncate ${isUnknown ? 'text-gray-600' : 'text-gray-200'}`}>
                                  {isUnknown ? 'Unknown' : d.airport}
                                  {!isUnknown && d.name && d.name !== d.airport && (
                                    <span className="text-gray-600 font-normal ml-1 text-[9px]">{d.name}</span>
                                  )}
                                </span>
                                <span className={`shrink-0 font-mono text-[10px] ${isUnknown ? 'text-gray-600' : 'text-gray-400'}`}>{d.count}</span>
                              </div>
                              <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
                                <div className={`h-full rounded-full ${isUnknown ? 'bg-gray-700' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
    </div>
  );
}
