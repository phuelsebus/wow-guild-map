import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { CONTINENTS, WORLD, POS_STALE_MS, classColor, toLatLng } from './wow.js';

/** Platzhalter, solange kein Kartenbild in web/public/maps liegt. */
function placeholder(c) {
  const lines = [];
  for (let i = 1; i < 10; i++) {
    lines.push(`<line x1="${(c.w * i) / 10}" y1="0" x2="${(c.w * i) / 10}" y2="${c.h}"/>`);
    lines.push(`<line x1="0" y1="${(c.h * i) / 10}" x2="${c.w}" y2="${(c.h * i) / 10}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}">
    <defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#3b3222"/><stop offset="1" stop-color="#1c1810"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <g stroke="#6b5a3a" stroke-opacity=".35" stroke-width="1">${lines.join('')}</g>
    <rect x="1" y="1" width="${c.w - 2}" height="${c.h - 2}" fill="none" stroke="#8a744a" stroke-width="2"/>
    <text x="50%" y="46%" text-anchor="middle" font-family="Cinzel, serif" font-size="46" fill="#c9a96a" fill-opacity=".8">${c.name}</text>
    <text x="50%" y="54%" text-anchor="middle" font-family="Inter, sans-serif" font-size="16" fill="#c9a96a" fill-opacity=".55">Kartenbild fehlt: web/public/maps/${c.file}.jpg</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function findImage(c) {
  // BASE_URL beachten, damit es auch unter github.io/<repo>/ funktioniert
  const candidates = ['jpg', 'png', 'webp'].map((ext) => `${import.meta.env.BASE_URL}maps/${c.file}.${ext}`);
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= candidates.length) return resolve(placeholder(c));
      const img = new Image();
      img.onload = () => resolve(candidates[i]);
      img.onerror = () => tryNext(i + 1);
      img.src = candidates[i];
    };
    tryNext(0);
  });
}

function markerIcon(m, stale) {
  return L.divIcon({
    className: 'pm',
    iconSize: [0, 0],
    html: `<div class="pm-wrap${stale ? ' stale' : ''}" style="--c:${classColor(m.class)}">
      <span class="pm-dot"></span><span class="pm-label">${escapeHtml(m.name)} <b>${m.level ?? '?'}</b></span>
    </div>`,
  });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Bewegt einen Marker weich zur neuen Position statt zu springen. */
function glide(marker, to, ms = 900) {
  cancelAnimationFrame(marker._glide);
  const from = marker.getLatLng();
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    marker.setLatLng([from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k]);
    if (k < 1) marker._glide = requestAnimationFrame(step);
  };
  marker._glide = requestAnimationFrame(step);
}

export default function MapView({ members, selected, onSelect, now }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());

  useEffect(() => {
    const m = L.map(el.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.25,
      attributionControl: false,
      maxBoundsViscosity: 0.8,
    });
    const bounds = [
      [-WORLD.h, 0],
      [0, WORLD.w],
    ];
    m.fitBounds(bounds);
    m.setMaxBounds(L.latLngBounds(bounds).pad(0.25));
    // Layout steht evtl. erst nach dem ersten Frame fest
    requestAnimationFrame(() => {
      m.invalidateSize();
      m.fitBounds(bounds, { padding: [20, 20] });
    });
    for (const c of Object.values(CONTINENTS)) {
      findImage(c).then((url) =>
        L.imageOverlay(url, [
          [-(c.y + c.h), c.x],
          [-c.y, c.x + c.w],
        ]).addTo(m).bringToBack(),
      );
    }
    map.current = m;
    const onResize = () => m.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      m.remove();
    };
  }, []);

  // Marker anlegen, bewegen, entfernen
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set();
    for (const mem of members) {
      if (!mem.online || !mem.pos) continue;
      seen.add(mem.name);
      const stale = now - (mem.posUpdatedAt ?? 0) > POS_STALE_MS;
      const key = `${mem.level}|${mem.class}|${stale}`;
      const ll = toLatLng(mem.pos);
      let mk = markers.current.get(mem.name);
      if (!mk) {
        mk = L.marker(ll, { icon: markerIcon(mem, stale), riseOnHover: true }).addTo(m);
        mk.on('click', () => onSelect(mem.name));
        mk._key = key;
        markers.current.set(mem.name, mk);
      } else {
        const cur = mk.getLatLng();
        if (cur.lat !== ll[0] || cur.lng !== ll[1]) glide(mk, ll);
        if (mk._key !== key) {
          mk.setIcon(markerIcon(mem, stale));
          mk._key = key;
        }
      }
      mk.getElement()?.classList.toggle('selected', mem.name === selected);
    }
    for (const [name, mk] of markers.current) {
      if (!seen.has(name)) {
        cancelAnimationFrame(mk._glide);
        mk.remove();
        markers.current.delete(name);
      }
    }
  }, [members, selected, now, onSelect]);

  // Ausgewähltes Mitglied anfliegen
  useEffect(() => {
    const mem = members.find((x) => x.name === selected);
    if (mem?.pos && map.current) map.current.flyTo(toLatLng(mem.pos), Math.max(map.current.getZoom(), 1), { duration: 0.8 });
    // nur bei Auswahlwechsel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return <div ref={el} className="map" />;
}
