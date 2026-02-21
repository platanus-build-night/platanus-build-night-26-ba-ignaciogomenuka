'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [replayMode, setReplayMode]     = useState(false);
  const [replaySteps, setReplaySteps]   = useState<ReplayStep[]>([]);
  const [replayIdx, setReplayIdx]       = useState(0);
  const [isPlaying, setIsPlaying]       = useState(false);
  const [playSpeed, setPlaySpeed]       = useState<1 | 4>(1);
  const [replayLoading, setReplayLoading] = useState(false);

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
      const res   = await fetch(`/replay/range?start=${start.toISOString()}&end=${end.toISOString()}&step_seconds=60`);
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

  const displaySnap = replayMode && replaySteps.length > 0 ? replaySteps[replayIdx] : snapshot;
  const kpis = displaySnap?.fleet_kpis;

  const filteredPositions = (displaySnap?.latest_positions ?? []).filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.tail_number.toLowerCase().includes(q) || p.icao24.toLowerCase().includes(q);
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'in_air'    && !p.on_ground) ||
      (statusFilter === 'on_ground' &&  p.on_ground);
    return matchSearch && matchStatus;
  });

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">

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
          <FleetMap positions={displaySnap?.latest_positions ?? []} />
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

      {/* ── Bottom: Fleet table ── */}
      <div className="h-44 shrink-0 border-t border-gray-800 bg-gray-900 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 shrink-0">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-1">Fleet</span>
          <input
            type="text"
            placeholder="Search tail / ICAO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-800 text-gray-200 text-[11px] rounded px-2 py-1 w-36 placeholder-gray-600 outline-none focus:ring-1 focus:ring-blue-700 transition-shadow"
          />
          <select
            value={statusFilter}
            onChange={e => setStatus(e.target.value as typeof statusFilter)}
            className="bg-gray-800 text-gray-200 text-[11px] rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-700"
          >
            <option value="all">All</option>
            <option value="in_air">In Air</option>
            <option value="on_ground">On Ground</option>
          </select>
          {!isLoading && (
            <span className="ml-auto text-[10px] text-gray-600">{filteredPositions.length} aircraft</span>
          )}
        </div>

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
                    {search || statusFilter !== 'all'
                      ? 'No aircraft match your filters.'
                      : 'No aircraft positions recorded yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
