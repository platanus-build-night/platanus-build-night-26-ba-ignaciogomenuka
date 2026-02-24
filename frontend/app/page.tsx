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
  ts: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  on_ground: boolean;
  source: string;
  location: string | null;
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

interface FlightEntry {
  tail_number: string;
  icao24: string;
  takeoff_ts: string;
  landing_ts: string | null;
  origin: string;
  origin_name: string;
  destination: string;
  destination_name: string;
  duration_s: number | null;
  velocity_kmh: number | null;
  cruise_alt: number | null;
  track_points: number;
}

interface TrackPoint {
  ts: string;
  lat: number;
  lon: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  on_ground: boolean;
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

function relTime(iso: string | null) {
  if (!iso) return '—';
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


const PLANES = [
  { icao24: 'e0659a', tail: 'LV-FVZ' },
  { icao24: 'e030cf', tail: 'LV-CCO' },
  { icao24: 'e06546', tail: 'LV-FUF' },
  { icao24: 'e0b341', tail: 'LV-KMA' },
  { icao24: 'e0b058', tail: 'LV-KAX' },
];

// ─── Mobile nav icons (inline SVG) ────────────────────────────────────────────
const IconMap     = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m-3-10.5V19.5M3 7.5l6-3 6 3 6-3v13.5l-6 3-6-3-6 3V7.5z" /></svg>;
const IconEvents  = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>;
const IconFleet   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>;
const IconFlights = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>;
const IconStats   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>;

function MonthlyChart({ series }: { series: MonthlySeries[] }) {
  if (!series.length) return (
    <div className="flex items-center justify-center h-20 text-xs text-gray-600">No data for selected range</div>
  );
  const max = Math.max(...series.map(s => s.flights), 1);
  const W = 500, H = 72, labelH = 14, valueH = 12;
  const bw = W / series.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + labelH + valueH}`} className="w-full" preserveAspectRatio="none">
      {series.map((s, i) => {
        const barH = Math.max(2, (s.flights / max) * H);
        const mo = new Date(s.month + '-02').toLocaleString('default', { month: 'short' });
        return (
          <g key={s.month}>
            <rect x={i * bw + 1} y={H - barH} width={bw - 2} height={barH}
              fill="#3b82f6" opacity={0.8} rx={1} />
            {/* value label above bar */}
            <text x={i * bw + bw / 2} y={H - barH - 2}
              textAnchor="middle" fontSize={8} fill="#93c5fd">{s.flights}</text>
            {/* month label below bar */}
            <text x={i * bw + bw / 2} y={H + labelH - 1}
              textAnchor="middle" fontSize={9} fill="#6b7280">{mo}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Flight board card ────────────────────────────────────────────────────────

const TAIL_COLORS: Record<string, string> = {
  'LV-FVZ': 'text-sky-300',
  'LV-CCO': 'text-emerald-300',
  'LV-FUF': 'text-amber-300',
  'LV-KMA': 'text-rose-300',
  'LV-KAX': 'text-violet-300',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtDur(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function FlightCard({ f }: { f: FlightEntry }) {
  const landed    = !!f.landing_ts;
  const unknown   = (v: string) => !v || v === '—' || v === 'UNKNOWN';
  const hasRoute  = !unknown(f.origin) || !unknown(f.destination);
  const durStr    = f.duration_s ? fmtDur(f.duration_s) : null;
  const altFL     = f.cruise_alt ? `FL${Math.round(f.cruise_alt / 100)}` : null;
  const tailColor = TAIL_COLORS[f.tail_number] ?? 'text-gray-200';

  return (
    <div className="shrink-0 w-full md:w-52 bg-gray-950 border border-gray-700/60 rounded-lg overflow-hidden flex flex-col">

      {/* ── Header strip ── */}
      <div className={`flex items-center justify-between px-3 py-2 border-b border-gray-800 ${
        landed ? 'bg-blue-950/40' : 'bg-green-950/40'
      }`}>
        <span className={`font-mono font-bold text-sm ${tailColor}`}>{f.tail_number}</span>
        <span className={`text-[10px] md:text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
          landed
            ? 'bg-blue-900/60 text-blue-300 border border-blue-800/60'
            : 'bg-green-900/60 text-green-300 border border-green-800/60 animate-pulse'
        }`}>
          {landed ? 'ATERRIZÓ' : 'EN VUELO'}
        </span>
      </div>

      {/* ── Route ── */}
      <div className="flex items-stretch gap-0 flex-1 px-3 py-2.5">
        {/* Origin */}
        <div className="flex flex-col items-center min-w-0 w-16 shrink-0">
          <span className={`font-mono text-xl font-black leading-none ${unknown(f.origin) ? 'text-gray-600' : 'text-amber-400'}`}>
            {unknown(f.origin) ? '???' : f.origin}
          </span>
          <span className="text-[10px] md:text-[9px] text-gray-500 text-center leading-tight mt-0.5 truncate w-full">
            {unknown(f.origin_name) ? 'desconocido' : f.origin_name.split(' ').slice(0, 2).join(' ')}
          </span>
        </div>

        {/* Arrow */}
        <div className="flex flex-col items-center justify-center flex-1 gap-0.5 px-1">
          <div className="w-full flex items-center">
            <div className="flex-1 border-t border-dashed border-gray-600" />
            <span className="text-gray-500 text-xs mx-0.5">✈</span>
            <div className="flex-1 border-t border-dashed border-gray-600" />
          </div>
          {hasRoute && durStr && (
            <span className="text-[10px] md:text-[9px] text-gray-600 font-mono">{durStr}</span>
          )}
        </div>

        {/* Destination */}
        <div className="flex flex-col items-center min-w-0 w-16 shrink-0">
          <span className={`font-mono text-xl font-black leading-none ${unknown(f.destination) ? 'text-gray-600' : 'text-amber-400'}`}>
            {unknown(f.destination) ? '???' : f.destination}
          </span>
          <span className="text-[10px] md:text-[9px] text-gray-500 text-center leading-tight mt-0.5 truncate w-full">
            {unknown(f.destination_name) ? 'desconocido' : f.destination_name.split(' ').slice(0, 2).join(' ')}
          </span>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="px-3 py-1.5 border-t border-gray-800 bg-gray-900/40 flex items-center justify-between text-[10px] text-gray-500 font-mono">
        <span>{fmtDate(f.takeoff_ts)} {fmtTime(f.takeoff_ts)}</span>
        {altFL && <span className="text-gray-600">{altFL}</span>}
        {f.landing_ts && <span>{fmtTime(f.landing_ts)}</span>}
      </div>
    </div>
  );
}

// ─── Fleet availability card ──────────────────────────────────────────────────

const TURNAROUND_MIN = 90;
const STALE_MIN      = 20; // min since last position before "in air" → "sin señal"

type AvailStatus = 'available' | 'in_flight' | 'turning' | 'stale' | 'unknown';

function availStatus(pos: Position | undefined, lastLandingTs: string | null): { status: AvailStatus; readyAt: Date | null } {
  if (!pos || !pos.ts) return { status: 'unknown', readyAt: null };

  const ageMin = (Date.now() - new Date(pos.ts).getTime()) / 60000;

  if (!pos.on_ground) {
    // Landing event more recent than last position → confirmed landed
    if (lastLandingTs && lastLandingTs > pos.ts) {
      const landedAt  = new Date(lastLandingTs);
      const minSince  = (Date.now() - landedAt.getTime()) / 60000;
      if (minSince < TURNAROUND_MIN) {
        return { status: 'turning', readyAt: new Date(landedAt.getTime() + TURNAROUND_MIN * 60000) };
      }
      return { status: 'available', readyAt: null };
    }
    // Signal lost: was airborne but no new data in STALE_MIN
    if (ageMin > STALE_MIN) return { status: 'stale', readyAt: null };
    return { status: 'in_flight', readyAt: null };
  }

  // on_ground = true
  if (lastLandingTs) {
    const landedAt = new Date(lastLandingTs);
    const minAgo   = (Date.now() - landedAt.getTime()) / 60000;
    if (minAgo < TURNAROUND_MIN) {
      return { status: 'turning', readyAt: new Date(landedAt.getTime() + TURNAROUND_MIN * 60000) };
    }
  }
  return { status: 'available', readyAt: null };
}

const AVAIL_STYLES: Record<AvailStatus, string> = {
  available: 'bg-blue-900/50 text-blue-300 border border-blue-800/40',
  in_flight: 'bg-green-900/50 text-green-300 border border-green-800/40',
  turning:   'bg-orange-900/50 text-orange-300 border border-orange-800/40',
  stale:     'bg-yellow-900/50 text-yellow-300 border border-yellow-800/40',
  unknown:   'bg-gray-800 text-gray-600 border border-gray-700/40',
};
const AVAIL_LABELS: Record<AvailStatus, string> = {
  available: 'DISPONIBLE',
  in_flight: 'EN VUELO',
  turning:   'ROTANDO',
  stale:     'SIN SEÑAL',
  unknown:   'SIN DATOS',
};

function AvailCard({ plane, pos, lastLandingTs }: {
  plane: { icao24: string; tail: string };
  pos: Position | undefined;
  lastLandingTs: string | null;
}) {
  const { status, readyAt } = availStatus(pos, lastLandingTs);
  const tailColor = TAIL_COLORS[plane.tail] ?? 'text-gray-200';

  return (
    <div className="px-3 py-2.5 border-b border-gray-800 last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`font-mono font-bold text-sm ${tailColor}`}>{plane.tail}</span>
        <span className={`text-[10px] md:text-[9px] font-bold px-1.5 py-0.5 rounded ${AVAIL_STYLES[status]}`}>
          {AVAIL_LABELS[status]}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs md:text-[10px]">
        <span>
          {pos?.location
            ? <span className="font-mono font-semibold text-amber-400">
                {pos.location}
                {status === 'stale' && <span className="text-gray-600 font-normal ml-1 text-[9px]">último</span>}
              </span>
            : status === 'in_flight'
              ? <span className="text-gray-500">en ruta</span>
              : <span className="text-gray-600">sin ubicación</span>}
        </span>
        <span className={status === 'stale' ? 'text-yellow-600 font-medium' : 'text-gray-600'}>
          {pos?.ts ? relTime(pos.ts) : '—'}
        </span>
      </div>
      {status === 'turning' && readyAt && (
        <div className="mt-1 text-[10px] md:text-[9px] text-orange-400/80 font-mono">
          lista ~{readyAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [snapshot, setSnapshot]       = useState<Snapshot | null>(null);
  const [freshness, setFreshness]     = useState(0);
  const [isLoading, setIsLoading]     = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatus]     = useState<'all' | 'in_air' | 'on_ground'>('all');
  const [newKeys, setNewKeys]         = useState<Set<string>>(new Set());

  // Replay state (card-triggered)
  const [replayMode, setReplayMode]         = useState(false);
  const [replaySteps, setReplaySteps]       = useState<ReplayStep[]>([]);
  const [replayIdx, setReplayIdx]           = useState(0);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [playSpeed, setPlaySpeed]           = useState<1 | 2 | 4>(1);
  const [replayAircraft, setReplayAircraft] = useState('');
  const [activeReplayKey, setActiveReplayKey] = useState<string | null>(null);
  const [trackLoading, setTrackLoading]     = useState<string | null>(null); // key being loaded

  const [activeTab, setActiveTab]           = useState<'fleet' | 'analytics' | 'flights'>('fleet');
  const [mobileTab, setMobileTab]           = useState<'map' | 'events' | 'fleet' | 'flights' | 'stats'>('map');
  const [flights, setFlights]               = useState<FlightEntry[]>([]);
  const [flightsLoading, setFlightsLoading] = useState(false);

  // Events feed mode
  const [feedMode, setFeedMode]             = useState<'live' | 'history'>('live');
  const [flightHistory, setFlightHistory]   = useState<FlightEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError]     = useState<string | null>(null);

  // Monthly analytics state
  const today   = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const [analyticsStart, setAnalyticsStart]   = useState(yearAgo);
  const [analyticsEnd,   setAnalyticsEnd]     = useState(today);
  const [analyticsAircraft, setAnalyticsAircraft] = useState('');
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

  useEffect(() => {
    if (replayMode) return;
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, 5000);
    return () => clearInterval(id);
  }, [fetchSnapshot, replayMode]);

  // Tick displayed freshness every second
  useEffect(() => {
    const id = setInterval(() => setFreshness(f => f + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Replay: advance index when playing
  useEffect(() => {
    if (!isPlaying || !replayMode) return;
    const ms = playSpeed === 4 ? 250 : playSpeed === 2 ? 500 : 1000;
    const id = setInterval(() => {
      setReplayIdx(i => {
        if (i >= replaySteps.length - 1) { setIsPlaying(false); return i; }
        return i + 1;
      });
    }, ms);
    return () => clearInterval(id);
  }, [isPlaying, replayMode, playSpeed, replaySteps.length]);

  function stopReplay() {
    setReplayMode(false);
    setActiveReplayKey(null);
    setIsPlaying(false);
    setReplaySteps([]);
    setReplayIdx(0);
  }

  async function startTrackReplay(flight: FlightEntry) {
    const key = `${flight.icao24}-${flight.takeoff_ts}`;
    setTrackLoading(key);
    try {
      const p = new URLSearchParams({ takeoff_ts: flight.takeoff_ts });
      if (flight.landing_ts) p.set('landing_ts', flight.landing_ts);
      const res = await fetch(`/api/flights/${flight.icao24}/track?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { track }: { track: TrackPoint[] } = await res.json();
      if (!track.length) throw new Error('Sin datos de track');
      const steps: ReplayStep[] = track.map(pt => ({
        ts: pt.ts,
        fleet_kpis: { in_air: 1, on_ground: 4, seen_last_15m: 1, events_last_hour: 0 },
        latest_positions: [{
          tail_number: flight.tail_number,
          icao24:      flight.icao24,
          ts:          pt.ts,
          lat:         pt.lat,
          lon:         pt.lon,
          altitude:    pt.altitude,
          velocity:    pt.velocity,
          heading:     pt.heading,
          on_ground:   pt.on_ground,
          source:      'track',
          location:    null,
        }],
        last_50_events: [],
      }));
      setReplaySteps(steps);
      setReplayIdx(0);
      setReplayAircraft(flight.icao24);
      setIsPlaying(false);
      setReplayMode(true);
      setActiveReplayKey(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Track fetch failed');
    } finally {
      setTrackLoading(null);
    }
  }

  const fetchMonthly = useCallback(async () => {
    setMLoading(true);
    try {
      const p = new URLSearchParams({ start_date: analyticsStart, end_date: analyticsEnd });
      if (analyticsAircraft) p.set('aircraft_id', analyticsAircraft);
      const res = await fetch(`/analytics/monthly?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMonthly(await res.json());
    } catch (e) {
      console.error('fetchMonthly error:', e);
    } finally { setMLoading(false); }
  }, [analyticsStart, analyticsEnd, analyticsAircraft]);

  useEffect(() => { fetchMonthly(); }, [fetchMonthly]);

  const fetchTopDest = useCallback(async () => {
    setTopDestLoading(true);
    try {
      const p = new URLSearchParams({ start_date: analyticsStart, end_date: analyticsEnd });
      if (analyticsAircraft) p.set('aircraft_id', analyticsAircraft);
      const res = await fetch(`/analytics/top-destinations?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTopDest(data.top_destinations ?? []);
    } catch (e) {
      console.error('fetchTopDest error:', e);
    } finally { setTopDestLoading(false); }
  }, [analyticsStart, analyticsEnd, analyticsAircraft]);

  useEffect(() => { fetchTopDest(); }, [fetchTopDest]);

  const fetchFlights = useCallback(async () => {
    setFlightsLoading(true);
    try {
      const res = await fetch('/api/flight-board?limit=40');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFlights(data.flights ?? []);
    } catch { /* silent */ }
    finally { setFlightsLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'flights') fetchFlights();
  }, [activeTab, fetchFlights]);

  const fetchFlightHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch('/api/flight-board?limit=40');
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const body = await res.json(); if (body.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setFlightHistory(data.flights ?? []);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Error al cargar historial');
    } finally { setHistoryLoading(false); }
  }, []);

  // Fetch on mount so data is ready when user switches to Historial
  useEffect(() => { fetchFlightHistory(); }, [fetchFlightHistory]);

  useEffect(() => {
    if (feedMode !== 'history' && replayMode) stopReplay();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedMode]);

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

  const lastLandingByAircraft = useMemo(() => {
    const map: Record<string, string> = {};
    (displaySnap?.last_50_events ?? []).forEach(ev => {
      if (ev.type === 'LANDING' && (!map[ev.icao24] || ev.ts > map[ev.icao24])) {
        map[ev.icao24] = ev.ts;
      }
    });
    return map;
  }, [displaySnap]);

  const availCounts = useMemo(() => {
    let available = 0, in_flight = 0, turning = 0, stale = 0;
    PLANES.forEach(plane => {
      const pos = displaySnap?.latest_positions.find(p => p.icao24 === plane.icao24);
      const { status } = availStatus(pos, lastLandingByAircraft[plane.icao24] ?? null);
      if (status === 'available')  available++;
      else if (status === 'in_flight') in_flight++;
      else if (status === 'turning')   turning++;
      else if (status === 'stale')     stale++;
    });
    return { available, in_flight, turning, stale };
  }, [displaySnap, lastLandingByAircraft]);

  const filteredPositions = (displaySnap?.latest_positions ?? []).filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.tail_number.toLowerCase().includes(q) || p.icao24.toLowerCase().includes(q);
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'in_air'    && !p.on_ground) ||
      (statusFilter === 'on_ground' &&  p.on_ground);
    return matchSearch && matchStatus;
  });

  // Live feed: exclude completed flights (TAKEOFF that has a matching LANDING, and LANDING events)
  const allFeedEvents = displaySnap?.last_50_events ?? [];
  const landedTakeoffKeys = new Set<string>();
  allFeedEvents.forEach(ev => {
    if (ev.type === 'LANDING') {
      const matchingTakeoff = allFeedEvents.find(
        e2 => e2.icao24 === ev.icao24 && e2.type === 'TAKEOFF' && e2.ts < ev.ts
      );
      if (matchingTakeoff) landedTakeoffKeys.add(`${matchingTakeoff.icao24}-${matchingTakeoff.ts}`);
    }
  });
  const liveEvents = allFeedEvents.filter(ev => {
    if (ev.type === 'LANDING') return false;
    if (ev.type === 'TAKEOFF' && landedTakeoffKeys.has(`${ev.icao24}-${ev.ts}`)) return false;
    return true;
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
            <div className="hidden md:flex gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-green-900 text-green-300 font-medium">{kpis.in_air} in air</span>
              <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{kpis.on_ground} on ground</span>
              <span className="px-2 py-0.5 rounded-full bg-purple-900 text-purple-300">{kpis.seen_last_15m} seen/15m</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-900 text-blue-300">{kpis.events_last_hour} events/h</span>
            </div>
          ) : (
            isLoading && (
              <div className="hidden md:flex gap-1.5">
                {[56, 64, 72, 56].map((w, i) => <Skeleton key={i} className={`h-5 w-${w / 4} rounded-full`} />)}
              </div>
            )
          )}
        </div>
        <div className="hidden md:flex items-center gap-3 text-[11px]">
          <span className="text-gray-500">
            Data age: <span className={freshness > 60 ? 'text-yellow-400' : 'text-gray-400'}>{freshness}s</span>
          </span>
          {replayMode && (
            <button
              onClick={stopReplay}
              className="px-2 py-1 rounded text-[11px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              📡 Live
            </button>
          )}
        </div>
      </header>


      {/* ── Main row ── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: Event feed / Flight history */}
        <aside className={`w-full md:w-72 shrink-0 flex-col border-r border-gray-800 bg-gray-900 overflow-hidden ${mobileTab === 'events' ? 'flex' : 'hidden'} md:flex`}>
          {/* Live / Historial toggle */}
          <div className="flex shrink-0 border-b border-gray-800">
            {(['live', 'history'] as const).map(m => (
              <button key={m} onClick={() => setFeedMode(m)}
                className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  feedMode === m
                    ? 'text-white bg-gray-800/60 border-b-2 border-b-blue-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}>
                {m === 'live' ? 'Live' : 'Historial'}
              </button>
            ))}
          </div>

          {/* ── LIVE MODE ── */}
          {feedMode === 'live' && (
            <div className="flex-1 overflow-y-auto">
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-3 py-2.5 border-b border-gray-800/50">
                  <div className="flex justify-between mb-1.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <Skeleton className="h-2 w-24 mb-1" />
                  <Skeleton className="h-2 w-20" />
                </div>
              ))}

              {!isLoading && (displaySnap?.last_50_events.length ?? 0) === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="text-2xl mb-2 opacity-30">📋</div>
                  <p className="text-xs text-gray-600">Sin vuelos activos.<br />Los vuelos completados están en Historial.</p>
                </div>
              )}

              <div className="divide-y divide-gray-800/50">
                {liveEvents.map(ev => {
                  const k = eventKey(ev);
                  const isNew = newKeys.has(k);
                  const pos = displaySnap?.latest_positions.find(p => p.icao24 === ev.icao24);
                  const tailColor = TAIL_COLORS[ev.tail_number] ?? 'text-gray-200';
                  const replayKey = `${ev.icao24}-${ev.ts}`;
                  const isActiveReplay = activeReplayKey === replayKey;
                  const isLoadingThis = trackLoading === replayKey;

                  // Build a synthetic FlightEntry for replay (live flight in progress)
                  const liveFlightForReplay: FlightEntry = {
                    tail_number: ev.tail_number, icao24: ev.icao24,
                    takeoff_ts: ev.ts, landing_ts: null,
                    origin: String(ev.meta.origin_airport ?? ''), origin_name: String(ev.meta.origin_name ?? ''),
                    destination: '—', destination_name: '—',
                    duration_s: null, velocity_kmh: null, cruise_alt: null, track_points: 0,
                  };

                  const canReplay = ev.type === 'TAKEOFF' || ev.type === 'LANDING';
                  // For LANDING, find matching TAKEOFF to use as takeoff_ts
                  const landingFlightForReplay: FlightEntry | null = ev.type === 'LANDING' ? (() => {
                    const matchingTakeoff = allFeedEvents.find(
                      e2 => e2.icao24 === ev.icao24 && e2.type === 'TAKEOFF' && e2.ts < ev.ts
                    );
                    if (!matchingTakeoff) return null;
                    return {
                      tail_number: ev.tail_number, icao24: ev.icao24,
                      takeoff_ts: matchingTakeoff.ts, landing_ts: ev.ts,
                      origin: String(matchingTakeoff.meta.origin_airport ?? ''),
                      origin_name: String(matchingTakeoff.meta.origin_name ?? ''),
                      destination: String(ev.meta.destination_airport ?? '—'),
                      destination_name: String(ev.meta.destination_name ?? '—'),
                      duration_s: null, velocity_kmh: null, cruise_alt: null, track_points: 0,
                    };
                  })() : null;

                  const flightForReplay = ev.type === 'LANDING' ? landingFlightForReplay : liveFlightForReplay;

                  return (
                    <div key={k} className={`px-3 py-2.5 transition-all duration-500 ${
                      isNew ? 'bg-blue-950/50 border-l-2 border-blue-500' : 'hover:bg-gray-800/40'
                    }`}>
                      {/* Row 1: tail + badge */}
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`font-mono font-bold text-xs ${tailColor}`}>{ev.tail_number}</span>
                          <span className="text-[10px] md:text-[9px] text-gray-600 font-mono">{ev.icao24}</span>
                        </div>
                        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase whitespace-nowrap ${eventBadge(ev.type)}`}>
                          {ev.type === 'EMERGENCY' ? '⚠ ' : ''}{ev.type}
                        </span>
                      </div>

                      {/* Row 2: context */}
                      {ev.type === 'TAKEOFF' && (
                        <div className="text-[10px] text-gray-400 mb-0.5">
                          <span className="font-mono text-amber-500">{String(ev.meta.origin_airport ?? '???')}</span>
                          <span className="text-gray-600 mx-1">→</span>
                          <span className="text-gray-500">en ruta</span>
                          <span className="text-gray-600 mx-1.5">·</span>
                          <span className="text-gray-500">{relTime(ev.ts)}</span>
                        </div>
                      )}
                      {ev.type === 'LANDING' && (
                        <div className="text-[10px] text-gray-400 mb-0.5">
                          <span className="text-gray-500">???</span>
                          <span className="text-gray-600 mx-1">→</span>
                          <span className="font-mono text-amber-500">{String(ev.meta.destination_airport ?? '???')}</span>
                          <span className="text-gray-600 mx-1.5">·</span>
                          <span className="text-gray-500">{relTime(ev.ts)}</span>
                        </div>
                      )}
                      {ev.type === 'APPEARED' && (
                        <div className="text-[10px] text-gray-500 mb-0.5">
                          Reapareció tras {Math.round(Number(ev.meta.gap_seconds ?? 0) / 3600)}h sin señal
                          <span className="text-gray-600 mx-1">·</span>{relTime(ev.ts)}
                        </div>
                      )}
                      {ev.type === 'EMERGENCY' && (
                        <div className="text-[10px] text-red-400 mb-0.5">
                          Squawk {String(ev.meta.squawk ?? '????')} detectado
                          <span className="text-gray-600 mx-1">·</span>{relTime(ev.ts)}
                        </div>
                      )}
                      {ev.type === 'IN_PROGRESS' && (
                        <div className="text-[10px] text-gray-500 mb-0.5">{relTime(ev.ts)}</div>
                      )}

                      {/* Row 3: flight stats (from current position) */}
                      {pos && (pos.altitude != null || pos.velocity != null) && (
                        <div className="text-[10px] md:text-[9px] text-gray-600 font-mono mb-1">
                          {pos.altitude != null && <span>{Math.round(pos.altitude)}ft</span>}
                          {pos.velocity != null && <span className="ml-1.5">{Math.round(pos.velocity)}km/h</span>}
                          {pos.heading  != null && <span className="ml-1.5">{Math.round(pos.heading)}°</span>}
                        </div>
                      )}

                      {/* Replay controls (inline, only when active) */}
                      {isActiveReplay && (
                        <div className="mt-1.5 p-2 bg-indigo-950/60 rounded border border-indigo-800/50">
                          <div className="flex items-center gap-1.5 mb-1">
                            <button onClick={() => setIsPlaying(p => !p)}
                              className="px-1.5 py-0.5 rounded bg-indigo-800 hover:bg-indigo-700 text-white text-[10px] transition-colors">
                              {isPlaying ? '⏸' : '▶'}
                            </button>
                            <button onClick={() => setPlaySpeed(s => s === 1 ? 2 : s === 2 ? 4 : 1)}
                              className="px-1.5 py-0.5 rounded bg-indigo-900 hover:bg-indigo-800 text-indigo-300 text-[10px] transition-colors">
                              {playSpeed}x
                            </button>
                            <span className="text-[9px] text-indigo-400 font-mono ml-auto">
                              {replaySteps[replayIdx]
                                ? new Date(replaySteps[replayIdx].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </span>
                            <button onClick={stopReplay} className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors">✕</button>
                          </div>
                          <input type="range" min={0} max={Math.max(0, replaySteps.length - 1)}
                            value={replayIdx}
                            onChange={e => { setIsPlaying(false); setReplayIdx(+e.target.value); }}
                            className="w-full accent-indigo-400 h-1" />
                        </div>
                      )}

                      {/* Replay button (only for TAKEOFF / LANDING, not active) */}
                      {canReplay && !isActiveReplay && flightForReplay && (
                        <button
                          onClick={() => startTrackReplay(flightForReplay)}
                          disabled={isLoadingThis}
                          className="mt-1.5 w-full text-[9px] font-medium py-1 rounded bg-indigo-900/60 hover:bg-indigo-800/60 text-indigo-300 border border-indigo-800/40 transition-colors disabled:opacity-40"
                        >
                          {isLoadingThis ? '⏳ Cargando…' : '⏵ Replay'}
                        </button>
                      )}

                      {isNew && <div className="text-[9px] text-blue-400 mt-0.5">● new</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── HISTORY MODE ── */}
          {feedMode === 'history' && (
            <div className="flex-1 overflow-y-auto flex flex-col">
              {/* sub-header with refresh */}
              <div className="px-3 py-1.5 border-b border-gray-800 shrink-0 flex items-center justify-between text-[10px] text-gray-500">
                <span>{historyLoading ? 'Cargando…' : `${flightHistory.length} vuelos`}</span>
                <button onClick={fetchFlightHistory} disabled={historyLoading}
                  className="hover:text-gray-300 transition-colors disabled:opacity-40">↺</button>
              </div>

              {historyError && (
                <div className="mx-3 mt-2 px-2 py-1.5 bg-red-950/60 border border-red-800/40 rounded text-[10px] text-red-400">
                  {historyError}
                </div>
              )}

              {historyLoading && Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-3 py-3 border-b border-gray-800/50">
                  <div className="flex justify-between mb-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <Skeleton className="h-2 w-32 mb-1.5" />
                  <Skeleton className="h-2 w-24" />
                </div>
              ))}

              {!historyLoading && !historyError && flightHistory.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="text-2xl mb-2 opacity-30">✈️</div>
                  <p className="text-xs text-gray-600">Sin historial de vuelos.</p>
                </div>
              )}

              <div className="divide-y divide-gray-800/50">
                {flightHistory.map((f, i) => {
                  const key = `${f.icao24}-${f.takeoff_ts}`;
                  const isActiveReplay = activeReplayKey === key;
                  const isLoadingThis = trackLoading === key;
                  const tailColor = TAIL_COLORS[f.tail_number] ?? 'text-gray-200';
                  const hasTrack = f.track_points >= 3;
                  const unknownOrig = !f.origin || f.origin === '—';
                  const unknownDest = !f.destination || f.destination === '—';

                  return (
                    <div key={`${key}-${i}`} className="px-3 py-2.5 hover:bg-gray-800/40 transition-colors">
                      {/* Row 1: tail + status */}
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className={`font-mono font-bold text-xs ${tailColor}`}>{f.tail_number}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          f.landing_ts
                            ? 'bg-blue-900/60 text-blue-300 border border-blue-800/40'
                            : 'bg-green-900/60 text-green-300 border border-green-800/40 animate-pulse'
                        }`}>
                          {f.landing_ts ? 'COMPLETE' : 'EN VUELO'}
                        </span>
                      </div>

                      {/* Row 2: route */}
                      <div className="flex items-center gap-1 text-[11px] mb-1">
                        <span className={`font-mono font-bold ${unknownOrig ? 'text-gray-600' : 'text-amber-400'}`}>
                          {unknownOrig ? '???' : f.origin}
                        </span>
                        <span className="text-gray-600 flex-1 text-center text-[8px]">───✈───</span>
                        <span className={`font-mono font-bold ${unknownDest ? 'text-gray-600' : 'text-amber-400'}`}>
                          {unknownDest ? '???' : f.destination}
                        </span>
                      </div>

                      {/* Row 3: times + duration */}
                      <div className="text-[9px] text-gray-500 font-mono mb-1">
                        {fmtDate(f.takeoff_ts)} {fmtTime(f.takeoff_ts)}
                        {f.landing_ts && <span> → {fmtTime(f.landing_ts)}</span>}
                        {f.duration_s && <span className="text-gray-600 ml-1">· {fmtDur(f.duration_s)}</span>}
                      </div>

                      {/* Row 4: track info */}
                      <div className="text-[9px] text-gray-700 mb-1.5">
                        {f.track_points} puntos de track
                      </div>

                      {/* Inline replay controls */}
                      {isActiveReplay && (
                        <div className="mt-1 p-2 bg-indigo-950/60 rounded border border-indigo-800/50">
                          <div className="flex items-center gap-1.5 mb-1">
                            <button onClick={() => setIsPlaying(p => !p)}
                              className="px-1.5 py-0.5 rounded bg-indigo-800 hover:bg-indigo-700 text-white text-[10px] transition-colors">
                              {isPlaying ? '⏸' : '▶'}
                            </button>
                            <button onClick={() => setPlaySpeed(s => s === 1 ? 2 : s === 2 ? 4 : 1)}
                              className="px-1.5 py-0.5 rounded bg-indigo-900 hover:bg-indigo-800 text-indigo-300 text-[10px] transition-colors">
                              {playSpeed}x
                            </button>
                            <span className="text-[9px] text-indigo-400 font-mono ml-auto">
                              {replaySteps[replayIdx]
                                ? new Date(replaySteps[replayIdx].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : '—'}
                            </span>
                            <button onClick={stopReplay} className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors">✕</button>
                          </div>
                          <input type="range" min={0} max={Math.max(0, replaySteps.length - 1)}
                            value={replayIdx}
                            onChange={e => { setIsPlaying(false); setReplayIdx(+e.target.value); }}
                            className="w-full accent-indigo-400 h-1" />
                        </div>
                      )}

                      {/* Replay button */}
                      {!isActiveReplay && (
                        <button
                          onClick={() => hasTrack && startTrackReplay(f)}
                          disabled={!hasTrack || !!isLoadingThis}
                          title={!hasTrack ? 'Replay no disponible: datos de track insuficientes.' : undefined}
                          className={`w-full text-[9px] font-medium py-1 rounded border transition-colors ${
                            hasTrack
                              ? 'bg-indigo-900/60 hover:bg-indigo-800/60 text-indigo-300 border-indigo-800/40'
                              : 'bg-gray-800/40 text-gray-600 border-gray-700/40 cursor-not-allowed'
                          }`}
                        >
                          {isLoadingThis ? '⏳ Cargando…' : hasTrack ? '⏵ Replay' : '⏵ Replay no disponible'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* Center: Map */}
        <div className={`flex-1 relative ${mobileTab === 'map' ? 'flex' : 'hidden'} md:flex`}>
          <FleetMap positions={displaySnap?.latest_positions ?? []} trail={trail.length > 1 ? trail : undefined} />
          {/* Mobile KPI overlay */}
          {kpis && (
            <div className="md:hidden absolute top-2 left-2 right-2 z-[1001] grid grid-cols-2 gap-1.5 pointer-events-none">
              <div className="bg-gray-900/85 backdrop-blur-sm rounded px-2.5 py-1.5 flex items-center gap-1.5">
                <span className="text-green-300 font-bold text-sm">{kpis.in_air}</span>
                <span className="text-gray-400 text-[10px]">in air</span>
              </div>
              <div className="bg-gray-900/85 backdrop-blur-sm rounded px-2.5 py-1.5 flex items-center gap-1.5">
                <span className="text-gray-300 font-bold text-sm">{kpis.on_ground}</span>
                <span className="text-gray-400 text-[10px]">on ground</span>
              </div>
              <div className="bg-gray-900/85 backdrop-blur-sm rounded px-2.5 py-1.5 flex items-center gap-1.5">
                <span className="text-purple-300 font-bold text-sm">{kpis.seen_last_15m}</span>
                <span className="text-gray-400 text-[10px]">seen/15m</span>
              </div>
              <div className="bg-gray-900/85 backdrop-blur-sm rounded px-2.5 py-1.5 flex items-center gap-1.5">
                <span className="text-blue-300 font-bold text-sm">{kpis.events_last_hour}</span>
                <span className="text-gray-400 text-[10px]">events/h</span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Fleet availability */}
        <aside className={`w-full md:w-72 shrink-0 flex-col border-l border-gray-800 bg-gray-900 ${mobileTab === 'stats' ? 'flex' : 'hidden'} md:flex`}>
          <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800 shrink-0">
            Disponibilidad
          </div>

          {/* Summary strip */}
          {!isLoading && (
            <div className="px-3 py-2 border-b border-gray-800 shrink-0 flex items-center gap-2 text-[11px]">
              <span className="text-blue-300 font-semibold">{availCounts.available} disponible{availCounts.available !== 1 ? 's' : ''}</span>
              {availCounts.in_flight > 0 && <>
                <span className="text-gray-700">·</span>
                <span className="text-green-400">{availCounts.in_flight} en vuelo</span>
              </>}
              {availCounts.turning > 0 && <>
                <span className="text-gray-700">·</span>
                <span className="text-orange-400">{availCounts.turning} rotando</span>
              </>}
              {availCounts.stale > 0 && <>
                <span className="text-gray-700">·</span>
                <span className="text-yellow-500">{availCounts.stale} sin señal</span>
              </>}
            </div>
          )}

          {/* Per-aircraft cards */}
          <div className="flex-1 overflow-y-auto">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="px-3 py-2.5 border-b border-gray-800">
                    <div className="flex justify-between mb-1.5">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))
              : PLANES.map(plane => {
                  const pos = displaySnap?.latest_positions.find(p => p.icao24 === plane.icao24);
                  return (
                    <AvailCard
                      key={plane.icao24}
                      plane={plane}
                      pos={pos}
                      lastLandingTs={lastLandingByAircraft[plane.icao24] ?? null}
                    />
                  );
                })}
          </div>

          {/* Turnaround note */}
          <div className="px-3 py-2 border-t border-gray-800 shrink-0 text-[9px] text-gray-700">
            Rotación estimada: {TURNAROUND_MIN} min desde aterrizaje
          </div>

          {/* Mobile-only analytics section */}
          <div className="md:hidden flex-1 overflow-y-auto border-t border-gray-800 px-3 py-3">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Analytics</div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {([
                { label: 'Vuelos',     value: mkpi?.total_flights,   color: 'text-white' },
                { label: 'Despegues',  value: mkpi?.takeoffs,        color: 'text-green-400' },
                { label: 'Aterrizajes',value: mkpi?.landings,        color: 'text-blue-400' },
                { label: 'Aeronaves',  value: mkpi?.active_aircraft, color: 'text-purple-400' },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="bg-gray-800/60 rounded px-2.5 py-2 flex items-center gap-2">
                  {mLoading ? <Skeleton className="h-5 w-8" /> : <span className={`text-base font-bold ${color}`}>{value ?? '—'}</span>}
                  <span className="text-[10px] text-gray-500 leading-tight">{label}</span>
                </div>
              ))}
            </div>
            <div className="mb-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Vuelos por mes</div>
              {mLoading ? <Skeleton className="h-24 w-full" /> : <MonthlyChart series={monthly?.monthly_series ?? []} />}
            </div>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Top destinos</div>
              {topDestLoading && <div className="flex flex-col gap-1.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>}
              {!topDestLoading && topDest.slice(0, 5).map((d, i) => (
                <div key={d.airport} className="flex items-center justify-between text-xs py-0.5">
                  <span className="text-gray-300 font-mono">{i + 1}. {d.airport}</span>
                  <span className="text-gray-500 font-mono">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Bottom Tabbed Panel ── */}
      <div className={`shrink-0 border-t border-gray-800 bg-gray-900 flex-col transition-[height] duration-300 ease-in-out ${
        activeTab === 'fleet' ? 'h-44' : 'h-80'
      } ${(mobileTab === 'fleet' || mobileTab === 'flights') ? 'flex' : 'hidden'} md:flex`}>

        {/* Tab bar */}
        <div className="flex items-center h-8 border-b border-gray-800 shrink-0">
          {([
            { key: 'fleet',     label: 'Fleet' },
            { key: 'flights',   label: 'Vuelos' },
            { key: 'analytics', label: 'Analytics' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`shrink-0 px-3 h-full text-[11px] font-medium border-r border-gray-800 transition-colors ${
                activeTab === key
                  ? 'text-white bg-gray-800/60 border-b-2 border-b-blue-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
              }`}
            >
              {label}
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
              <input type="date" value={analyticsStart}
                onChange={e => setAnalyticsStart(e.target.value)}
                className="bg-gray-800 text-gray-200 rounded px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-700" />
              <label className="text-gray-500 shrink-0">To</label>
              <input type="date" value={analyticsEnd}
                onChange={e => setAnalyticsEnd(e.target.value)}
                className="bg-gray-800 text-gray-200 rounded px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-700" />
              <select value={analyticsAircraft} onChange={e => setAnalyticsAircraft(e.target.value)}
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
            {/* Mobile card view */}
            <div className="md:hidden divide-y divide-gray-800/50">
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-3 py-3 flex justify-between">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
              {!isLoading && filteredPositions.map(p => {
                const { status: fs } = availStatus(p, lastLandingByAircraft[p.icao24] ?? null);
                const tailColor = TAIL_COLORS[p.tail_number] ?? 'text-gray-200';
                const fsLabel =
                  fs === 'in_flight' ? 'En vuelo' : fs === 'stale' ? 'Sin señal' :
                  fs === 'turning' ? 'Rotando' : fs === 'unknown' ? 'Sin datos' : 'En tierra';
                const fsBadge =
                  fs === 'in_flight' ? 'bg-green-900/80 text-green-300' :
                  fs === 'stale'     ? 'bg-yellow-900/80 text-yellow-300 animate-pulse' :
                  fs === 'turning'   ? 'bg-orange-900/80 text-orange-300' :
                  fs === 'unknown'   ? 'bg-gray-800 text-gray-600' :
                                      'bg-gray-700 text-gray-400';
                return (
                  <div key={p.icao24} className="px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`font-mono font-bold text-sm ${tailColor}`}>{p.tail_number}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${fsBadge}`}>{fsLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span className="font-mono text-amber-400">{p.location ?? '—'}</span>
                      <span>{p.velocity != null ? `${Math.round(p.velocity)} km/h` : '—'}</span>
                      <span className="text-gray-500">{relTime(p.ts)}</span>
                    </div>
                  </div>
                );
              })}
              {!isLoading && filteredPositions.length === 0 && (
                <div className="px-3 py-6 text-center text-gray-600 text-xs">
                  {search || statusFilter !== 'all' ? 'No aircraft match your filters.' : 'No aircraft positions recorded yet.'}
                </div>
              )}
            </div>
            {/* Desktop table */}
            <table className="hidden md:table w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-sm z-10">
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  {['Tail', 'ICAO24', 'Status', 'Location', 'Altitude', 'Speed', 'Heading', 'Source', 'Last seen'].map(h => (
                    <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {isLoading && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <Skeleton className="h-3" style={{ width: `${40 + (j * 13) % 40}px` }} />
                      </td>
                    ))}
                  </tr>
                ))}
                {!isLoading && filteredPositions.map(p => {
                  const { status: fs } = availStatus(p, lastLandingByAircraft[p.icao24] ?? null);
                  const fsBadge =
                    fs === 'in_flight' ? 'bg-green-900/80 text-green-300 ring-1 ring-green-800' :
                    fs === 'stale'     ? 'bg-yellow-900/80 text-yellow-300 ring-1 ring-yellow-800 animate-pulse' :
                    fs === 'turning'   ? 'bg-orange-900/80 text-orange-300 ring-1 ring-orange-800' :
                    fs === 'unknown'   ? 'bg-gray-800 text-gray-600' :
                                        'bg-gray-700 text-gray-400';
                  const fsLabel =
                    fs === 'in_flight' ? 'En vuelo' :
                    fs === 'stale'     ? 'Sin señal' :
                    fs === 'turning'   ? 'Rotando' :
                    fs === 'unknown'   ? 'Sin datos' : 'En tierra';
                  return (
                  <tr key={p.icao24} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-3 py-1.5 font-semibold text-white">{p.tail_number}</td>
                    <td className="px-3 py-1.5 text-gray-400 font-mono">{p.icao24}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${fsBadge}`}>
                        {fsLabel}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {p.location
                        ? <span className={`font-mono font-bold text-xs ${fs === 'stale' ? 'text-amber-600' : 'text-amber-400'}`}>
                            {p.location}
                            {fs === 'stale' && <span className="text-gray-600 font-normal ml-1">último</span>}
                          </span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-gray-300">{p.altitude != null ? `${Math.round(p.altitude)} ft` : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-300">{p.velocity != null ? `${Math.round(p.velocity)} km/h` : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-300">{p.heading != null ? `${Math.round(p.heading)}°` : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{p.source}</td>
                    <td className="px-3 py-1.5 text-gray-500">{relTime(p.ts)}</td>
                  </tr>
                  );
                })}
                {!isLoading && filteredPositions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-gray-600 text-xs">
                      {search || statusFilter !== 'all' ? 'No aircraft match your filters.' : 'No aircraft positions recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Flights content ── */}
        {activeTab === 'flights' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Sub-header */}
            <div className="px-4 py-1.5 border-b border-gray-800 shrink-0 flex items-center gap-3 text-[10px] text-gray-500">
              <span>Últimos {flights.length} vuelos</span>
              <button onClick={fetchFlights} className="hover:text-gray-300 transition-colors">↺ Actualizar</button>
              {flightsLoading && <span className="animate-pulse">Cargando…</span>}
            </div>
            {/* Cards — horizontal scroll on desktop, vertical on mobile */}
            <div className="flex-1 overflow-x-auto overflow-y-auto md:overflow-y-hidden">
              {flightsLoading && flights.length === 0 ? (
                <div className="flex gap-3 p-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="shrink-0 w-52 h-36 bg-gray-800 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : flights.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-gray-600">
                  No hay vuelos registrados aún.
                </div>
              ) : (
                <div className="flex flex-col md:flex-row gap-3 p-3 md:h-full md:items-center">
                  {flights.map((f, i) => <FlightCard key={`${f.icao24}-${f.takeoff_ts}-${i}`} f={f} />)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Analytics content ── */}
        {activeTab === 'analytics' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {([
                { label: 'Total Flights',   value: mkpi?.total_flights,   color: 'text-white' },
                { label: 'Takeoffs',        value: mkpi?.takeoffs,        color: 'text-green-400' },
                { label: 'Landings',        value: mkpi?.landings,        color: 'text-blue-400' },
                { label: 'W/ Flights',      value: mkpi?.active_aircraft, color: 'text-purple-400' },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="bg-gray-800/60 rounded px-3 py-2 flex items-center gap-3">
                  {mLoading
                    ? <Skeleton className="h-5 w-10" />
                    : <span className={`text-lg font-bold ${color}`}>{value ?? '—'}</span>}
                  <span className="text-[10px] md:text-[9px] text-gray-500 uppercase tracking-wide leading-tight">{label}</span>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

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

      {/* ── Mobile bottom navigation bar ── */}
      <nav className="mobile-bottom-nav md:hidden fixed bottom-0 left-0 right-0 h-14 bg-gray-900 border-t border-gray-800 flex items-stretch z-[2000]">
        {([
          { id: 'map',     label: 'Mapa',    Icon: IconMap },
          { id: 'events',  label: 'Eventos', Icon: IconEvents },
          { id: 'fleet',   label: 'Flota',   Icon: IconFleet },
          { id: 'flights', label: 'Vuelos',  Icon: IconFlights },
          { id: 'stats',   label: 'Stats',   Icon: IconStats },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => {
              setMobileTab(id);
              if (id === 'fleet')   setActiveTab('fleet');
              if (id === 'flights') setActiveTab('flights');
              if (id === 'stats')   setActiveTab('analytics');
            }}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              mobileTab === id ? 'text-blue-400' : 'text-gray-500 active:text-gray-300'
            }`}
          >
            <Icon />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
    </div>
  );
}
