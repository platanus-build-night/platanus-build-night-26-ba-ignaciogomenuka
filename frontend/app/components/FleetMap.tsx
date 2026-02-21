'use client';

import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

function planeIcon(heading: number | null) {
  const deg = heading ?? 0;
  const color = heading !== null ? '#60a5fa' : '#6b7280';
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${deg}deg);width:28px;height:28px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 4px rgba(96,165,250,0.5))">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="${color}">
        <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function fmt(v: number | null, unit: string) {
  return v != null ? `${Math.round(v)} ${unit}` : '—';
}

export default function FleetMap({ positions, trail }: { positions: Position[]; trail?: [number, number][] }) {
  const visible = positions.filter(p => p.lat != null && p.lon != null && !p.on_ground);

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[-34.6, -58.4]} zoom={5} className="h-full w-full">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        {trail && trail.length > 1 && (
          <Polyline positions={trail} color="#f59e0b" weight={2} opacity={0.75} />
        )}
        {visible.map(p => (
          <Marker key={p.icao24} position={[p.lat!, p.lon!]} icon={planeIcon(p.heading)}>
            <Popup>
              <div className="text-xs leading-5">
                <div className="font-semibold text-sm mb-1">{p.tail_number}</div>
                <div>Alt: {fmt(p.altitude, 'ft')}</div>
                <div>Speed: {fmt(p.velocity, 'km/h')}</div>
                <div>Heading: {p.heading != null ? `${Math.round(p.heading)}°` : '—'}</div>
                <div className="text-gray-400 mt-1 text-[10px]">{p.source}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Empty state overlay — only shown when there are no airborne aircraft */}
      {positions.length > 0 && visible.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1000]">
          <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-3 text-center">
            <div className="text-xl mb-1 opacity-40">🛬</div>
            <p className="text-xs text-gray-400">All aircraft on ground</p>
          </div>
        </div>
      )}

      {positions.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1000]">
          <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-3 text-center">
            <div className="text-xl mb-1 opacity-40">📡</div>
            <p className="text-xs text-gray-400">Waiting for aircraft positions…</p>
          </div>
        </div>
      )}
    </div>
  );
}
