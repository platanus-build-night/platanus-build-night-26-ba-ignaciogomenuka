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

// ---------------------------------------------------------------------------
// SDF plane icon — drawn on a canvas, registered once with the map.
// White fill on transparent background; MapLibre recolors via icon-color.
// Centered at canvas midpoint so icon-rotate pivots on the geographic pin.
// ---------------------------------------------------------------------------
function makePlaneIconData(size: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'white';

  // Plane path in [-12, 12] user space, pointing north (up).
  // Visual center is at (0,0) which maps to canvas center (size/2, size/2).
  const s = size / 24;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(1.5, -2);
  ctx.lineTo(10, -1);
  ctx.lineTo(10, 1);
  ctx.lineTo(1.5, 2);
  ctx.lineTo(2.5, 7);
  ctx.lineTo(2.5, 8);
  ctx.lineTo(0, 7);
  ctx.lineTo(-2.5, 8);
  ctx.lineTo(-2.5, 7);
  ctx.lineTo(-1.5, 2);
  ctx.lineTo(-10, 1);
  ctx.lineTo(-10, -1);
  ctx.lineTo(-1.5, -2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  return ctx.getImageData(0, 0, size, size);
}

// ---------------------------------------------------------------------------
// GeoJSON builder — positions → FeatureCollection consumed by the symbol layer
// ---------------------------------------------------------------------------
function buildGeoJSON(positions: Position[]) {
  return {
    type: 'FeatureCollection' as const,
    features: positions
      .filter(p => p.lat != null && p.lon != null)
      .map(pos => {
        // On-ground aircraft snap to the airport reference point when known.
        const lng = (pos.on_ground && pos.airport_lon != null
          ? pos.airport_lon : pos.lon) as number;
        const lat = (pos.on_ground && pos.airport_lat != null
          ? pos.airport_lat : pos.lat) as number;

        const staleH = pos.stale_hours ?? 0;
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lng, lat] },
          properties: {
            icao24:      pos.icao24,
            tail_number: pos.tail_number,
            color:       getColor(pos.tail_number),
            heading:     pos.heading ?? 0,
            on_ground:   pos.on_ground,
            stale:       staleH >= 2,
            stale_hours: staleH,
            altitude:    pos.altitude,
            velocity:    pos.velocity,
            location:    pos.location ?? '',
            source:      pos.source,
          },
        };
      }),
  };
}

// ---------------------------------------------------------------------------
// Popup HTML — accepts flattened properties from a GeoJSON feature
// ---------------------------------------------------------------------------
function fmtStale(h: number): string {
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1)  return `${Math.round(h)}h`;
  return `${Math.round(h * 60)}min`;
}

function buildPopupHTML(p: Record<string, unknown>): string {
  const color  = p.color as string;
  const alt    = p.altitude != null ? `${Math.round(p.altitude as number).toLocaleString()} ft` : '—';
  const fl     = p.altitude != null ? `FL${Math.round((p.altitude as number) / 100).toString().padStart(3, '0')}` : '';
  const vel    = p.velocity  != null ? `${Math.round(p.velocity  as number)} km/h` : '—';
  const hdg    = p.heading   != null ? `${Math.round(p.heading   as number)}°` : '—';
  const loc    = (p.location as string) || '';
  const staleH = (p.stale_hours as number) ?? 0;

  const staleBadge = staleH >= 2
    ? `<div style="color:#f59e0b;font-size:10px;margin-bottom:5px;opacity:.85">⚠ Sin señal hace ${fmtStale(staleH)}</div>`
    : '';

  const rows = p.on_ground
    ? `<div><span style="color:#475569">STATUS</span> <span style="color:#e2e8f0">En tierra</span></div>
       ${loc ? `<div style="color:${color};margin-top:2px;font-size:12px">${loc}</div>` : ''}`
    : `<div><span style="color:#475569">ALT</span> <span style="color:#e2e8f0">${alt}</span> <span style="color:#fbbf2466;font-size:10px">${fl}</span></div>
       <div><span style="color:#475569">SPD</span> <span style="color:#e2e8f0">${vel}</span></div>
       <div><span style="color:#475569">HDG</span> <span style="color:#e2e8f0">${hdg}</span></div>`;

  return `<div style="background:#0a1120;border:1px solid ${color}44;border-radius:8px;padding:10px 14px;
    min-width:165px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.9;
    box-shadow:0 8px 32px #00000099,0 0 0 1px ${color}18">
    <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:5px;letter-spacing:.06em">${p.tail_number}</div>
    ${staleBadge}
    <div style="color:#94a3b8">${rows}</div>
    <div style="color:#334155;font-size:10px;margin-top:6px;border-top:1px solid #1e293b;padding-top:5px">${p.source}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function FleetMap({
  positions,
  trail,
}: {
  positions: Position[];
  trail?: [number, number][];
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const readyRef      = useRef(false);
  const pulseFrameRef = useRef(0);

  // Keep latest prop values accessible from the map.on('load') closure
  // without re-running the init effect.
  const positionsRef = useRef(positions);
  const trailRef     = useRef(trail);
  positionsRef.current = positions;
  trailRef.current     = trail;

  // ── Map init (runs once) ──────────────────────────────────────────────────
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
      // ── Trail ──────────────────────────────────────────────────────────
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

      // ── SDF plane icon (registered once, recolored per-feature via icon-color) ──
      map.addImage('plane-icon', makePlaneIconData(64), { sdf: true });

      // ── Aircraft GeoJSON source ────────────────────────────────────────
      map.addSource('aircraft', {
        type: 'geojson',
        data: buildGeoJSON(positionsRef.current) as unknown as maplibregl.GeoJSONSourceSpecification['data'],
      });

      // Pulse ring — rendered in the same WebGL pass, airborne only
      map.addLayer({
        id: 'aircraft-pulse',
        type: 'circle',
        source: 'aircraft',
        filter: ['==', ['get', 'on_ground'], false],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            3, 8,
            10, 14,
          ],
          'circle-color': 'transparent',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.6,
        },
      });

      // Aircraft symbol — icon drawn in WebGL at the exact geographic coordinate.
      // icon-rotate uses the map projection's north reference (rotation-alignment:'map')
      // so the heading is always correct regardless of map bearing or zoom.
      map.addLayer({
        id: 'aircraft-layer',
        type: 'symbol',
        source: 'aircraft',
        layout: {
          'icon-image': 'plane-icon',
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            3,  0.30,
            8,  0.50,
            13, 0.75,
          ],
          'icon-rotate':               ['get', 'heading'],
          'icon-rotation-alignment':   'map',
          'icon-pitch-alignment':      'map',
          'icon-allow-overlap':        true,
          'icon-ignore-placement':     true,
        },
        paint: {
          'icon-color':       ['get', 'color'],
          'icon-halo-color':  ['get', 'color'],
          'icon-halo-width':  2,
          'icon-halo-blur':   1,
          'icon-opacity': [
            'case',
            ['all', ['get', 'on_ground'], ['get', 'stale']], 0.35,
            ['get', 'on_ground'],                            0.55,
            /* airborne */                                   1.0,
          ],
        },
      });

      // Tail label below the icon
      map.addLayer({
        id: 'aircraft-labels',
        type: 'symbol',
        source: 'aircraft',
        minzoom: 6,
        layout: {
          'text-field':         ['get', 'tail_number'],
          'text-font':          ['literal', ['Open Sans Bold', 'Arial Unicode MS Bold']],
          'text-size':          10,
          'text-offset':        [0, 1.8],
          'text-anchor':        'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color':       ['get', 'color'],
          'text-halo-color':  '#000000cc',
          'text-halo-width':  1.5,
          'text-opacity': [
            'case',
            ['get', 'on_ground'], 0.6,
            1.0,
          ],
        },
      });

      // ── Click → popup ──────────────────────────────────────────────────
      map.on('click', 'aircraft-layer', (e) => {
        if (!e.features?.length) return;
        const f      = e.features[0];
        const coords = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
        const props  = f.properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: false, className: 'fleet-popup', offset: 12 })
          .setLngLat(coords)
          .setHTML(buildPopupHTML(props))
          .addTo(map);
      });
      map.on('mouseenter', 'aircraft-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'aircraft-layer', () => { map.getCanvas().style.cursor = ''; });

      // ── Pulse animation (drives circle-stroke-opacity in WebGL) ───────
      const animate = () => {
        const t = (Date.now() % 2200) / 2200;
        // Smooth sine: 0.75 at t=0, 0 at t=0.5, 0.75 at t=1
        const opacity = 0.75 * (0.5 + 0.5 * Math.cos(2 * Math.PI * t));
        if (map.getLayer('aircraft-pulse')) {
          map.setPaintProperty('aircraft-pulse', 'circle-stroke-opacity', opacity);
        }
        pulseFrameRef.current = requestAnimationFrame(animate);
      };
      pulseFrameRef.current = requestAnimationFrame(animate);

      // Populate trail if data already arrived before map finished loading
      const t0 = trailRef.current;
      if (t0 && t0.length > 1) {
        (map.getSource('trail') as maplibregl.GeoJSONSource).setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: t0.map(([la, lo]) => [lo, la]) },
          properties: {},
        });
      }

      readyRef.current = true;
    });

    mapRef.current = map;
    return () => {
      cancelAnimationFrame(pulseFrameRef.current);
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Trail updates ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!readyRef.current) return;
    const src = mapRef.current?.getSource('trail') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const coords = (trail ?? []).map(([la, lo]) => [lo, la]);
    src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  }, [trail]);

  // ── Aircraft position updates ─────────────────────────────────────────────
  // Single setData call per update — MapLibre diffs and re-renders in one frame.
  useEffect(() => {
    if (!readyRef.current) return;
    const src = mapRef.current?.getSource('aircraft') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildGeoJSON(positions) as unknown as maplibregl.GeoJSONSourceSpecification['data']);
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
