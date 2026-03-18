'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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
  location?: string | null;
  airport_lat?: number | null;
  airport_lon?: number | null;
  stale_hours?: number | null;
}

const TAIL_COLORS: Record<string, string> = {
  'LV-FVZ': '#38bdf8',
  'LV-CCO': '#34d399',
  'LV-FUF': '#fbbf24',
  'LV-KMA': '#f87171',
  'LV-KAX': '#a78bfa',
  'LV-CPL': '#f472b6',
};

function getColor(tail: string) {
  return TAIL_COLORS[tail] ?? '#94a3b8';
}

function createMarkerEl(pos: Position, color: string): HTMLElement {
  // Wrapper is exactly 36×36 — MapLibre anchor:'center' will be pixel-perfect.
  // The pulse ring lives INSIDE the same box (inset:0) so it never expands
  // the element's bounding box and cannot skew the geographic anchor.
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:36px;height:36px;cursor:pointer;overflow:visible';

  if (!pos.on_ground) {
    const ring = document.createElement('div');
    ring.style.cssText = `
      position:absolute;inset:0;border-radius:50%;
      border:1.5px solid ${color};
      animation:fleet-pulse 2.2s ease-in-out infinite;
      pointer-events:none;
    `;
    wrap.appendChild(ring);
  }

  const deg = pos.heading ?? 0;
  const stale = (pos.stale_hours ?? 0) >= 2;
  const iconColor = pos.on_ground ? (stale ? '#78716c' : '#475569') : color;
  const glowAlpha = pos.on_ground ? '50' : 'bb';

  const plane = document.createElement('div');
  plane.className = 'fleet-plane';
  plane.style.cssText = `
    position:absolute;inset:0;
    display:flex;align-items:center;justify-content:center;
    transform:rotate(${deg}deg);transition:transform 0.9s ease;
    filter:drop-shadow(0 0 6px ${iconColor}${glowAlpha});
    opacity:${pos.on_ground ? (stale ? 0.4 : 0.55) : 1};
  `;
  plane.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="${iconColor}">
    <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
  </svg>`;

  wrap.appendChild(plane);
  return wrap;
}

function fmtStale(h: number): string {
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1)  return `${Math.round(h)}h`;
  return `${Math.round(h * 60)}min`;
}

function buildPopupHTML(pos: Position, color: string): string {
  const alt = pos.altitude != null ? `${Math.round(pos.altitude).toLocaleString()} ft` : '—';
  const fl  = pos.altitude != null ? `FL${Math.round(pos.altitude / 100).toString().padStart(3, '0')}` : '';
  const vel = pos.velocity  != null ? `${Math.round(pos.velocity)} km/h` : '—';
  const hdg = pos.heading   != null ? `${Math.round(pos.heading)}°` : '—';
  const loc = pos.location ?? '';
  const staleH = pos.stale_hours ?? 0;

  const staleBadge = staleH >= 2
    ? `<div style="color:#f59e0b;font-size:10px;margin-bottom:5px;opacity:0.85">⚠ Sin señal hace ${fmtStale(staleH)}</div>`
    : '';

  const rows = pos.on_ground
    ? `<div><span class="fp-lbl">STATUS</span> <span class="fp-val">En tierra</span></div>
       ${loc ? `<div style="color:${color};margin-top:2px;font-size:12px">${loc}</div>` : ''}`
    : `<div><span class="fp-lbl">ALT</span> <span class="fp-val">${alt}</span> <span style="color:#fbbf2477;font-size:10px">${fl}</span></div>
       <div><span class="fp-lbl">SPD</span> <span class="fp-val">${vel}</span></div>
       <div><span class="fp-lbl">HDG</span> <span class="fp-val">${hdg}</span></div>`;

  return `
    <div style="
      background:#0a1120;
      border:1px solid ${color}44;
      border-radius:8px;
      padding:10px 14px;
      min-width:165px;
      font-family:ui-monospace,monospace;
      box-shadow:0 8px 32px #00000099,0 0 0 1px ${color}18;
    ">
      <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:5px;letter-spacing:.06em">${pos.tail_number}</div>
      ${staleBadge}
      <div style="font-size:11px;line-height:1.9;color:#94a3b8">
        ${rows}
      </div>
      <div style="color:#334155;font-size:10px;margin-top:6px;border-top:1px solid #1e293b;padding-top:5px">${pos.source}</div>
    </div>
    <style>
      .fp-lbl{color:#475569}
      .fp-val{color:#e2e8f0}
    </style>
  `;
}

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://openstreetmap.org/">OSM</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto-dark', type: 'raster', source: 'carto' }],
};

type MarkerEntry = { marker: maplibregl.Marker; onGround: boolean };

export default function FleetMap({ positions, trail }: { positions: Position[]; trail?: [number, number][] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const markersRef   = useRef<Map<string, MarkerEntry>>(new Map());
  const trailReady   = useRef(false);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [-60, -35],
      zoom: 4,
      pitchWithRotate: false,
      dragRotate: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      map.addSource('trail', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: 'trail-glow',
        type: 'line',
        source: 'trail',
        paint: { 'line-color': '#f59e0b', 'line-width': 7, 'line-opacity': 0.12, 'line-blur': 5 },
      });
      map.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        paint: { 'line-color': '#f59e0b', 'line-width': 1.5, 'line-opacity': 0.65, 'line-dasharray': [5, 3] },
      });
      trailReady.current = true;
    });

    mapRef.current = map;
    return () => {
      trailReady.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update trail
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trailReady.current) return;
    const src = map.getSource('trail') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const coords = (trail ?? []).map(([lat, lon]) => [lon, lat]);
    src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  }, [trail]);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const pos of positions) {
      if (pos.lat == null || pos.lon == null) continue;

      const lng = pos.on_ground && pos.airport_lon != null ? pos.airport_lon : pos.lon;
      const lat = pos.on_ground && pos.airport_lat != null ? pos.airport_lat : pos.lat;
      const color = getColor(pos.tail_number);
      const key = pos.icao24;
      seen.add(key);

      const entry = markersRef.current.get(key);

      if (entry && entry.onGround === pos.on_ground) {
        entry.marker.setLngLat([lng, lat]);
        const plane = entry.marker.getElement().querySelector<HTMLElement>('.fleet-plane');
        if (plane && pos.heading != null) {
          plane.style.transform = `rotate(${pos.heading}deg)`;
        }
        entry.marker.setPopup(
          new maplibregl.Popup({ offset: 20, closeButton: false, className: 'fleet-popup' })
            .setHTML(buildPopupHTML(pos, color))
        );
      } else {
        entry?.marker.remove();
        const el = createMarkerEl(pos, color);
        const popup = new maplibregl.Popup({ offset: 20, closeButton: false, className: 'fleet-popup' })
          .setHTML(buildPopupHTML(pos, color));
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);
        markersRef.current.set(key, { marker, onGround: pos.on_ground });
      }
    }

    for (const [key, { marker }] of markersRef.current) {
      if (!seen.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }
  }, [positions]);

  const airborne = positions.filter(p => p.lat != null && !p.on_ground);
  const visible  = positions.filter(p => p.lat != null && (!p.on_ground || p.airport_lat != null)).length;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {positions.length > 0 && airborne.length === 0 && visible > 0 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-2">
            <p className="text-xs text-gray-400">Todos en tierra</p>
          </div>
        </div>
      )}

      {(positions.length === 0 || (positions.length > 0 && visible === 0)) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-3 text-center">
            {positions.length === 0 ? (
              <>
                <div className="text-xl mb-1 opacity-40">📡</div>
                <p className="text-xs text-gray-400">Waiting for aircraft positions…</p>
              </>
            ) : (
              <>
                <div className="text-xl mb-1 opacity-40">🛬</div>
                <p className="text-xs text-gray-400">All aircraft on ground</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
