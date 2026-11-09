export const CLASS_INFO = {
  WARRIOR: { name: 'Krieger', color: '#C69B6D' },
  PALADIN: { name: 'Paladin', color: '#F48CBA' },
  HUNTER: { name: 'Jäger', color: '#AAD372' },
  ROGUE: { name: 'Schurke', color: '#FFF468' },
  PRIEST: { name: 'Priester', color: '#FFFFFF' },
  SHAMAN: { name: 'Schamane', color: '#0070DD' },
  MAGE: { name: 'Magier', color: '#3FC7EB' },
  WARLOCK: { name: 'Hexenmeister', color: '#8788EE' },
  DRUID: { name: 'Druide', color: '#FF7C0A' },
};

export const classColor = (cls) => CLASS_INFO[cls]?.color ?? '#9aa0a6';
export const className = (cls) => CLASS_INFO[cls]?.name ?? 'Unbekannt';

/** Position gilt als veraltet, wenn sie älter als das ist. */
export const POS_STALE_MS = 60_000;

/**
 * Anordnung der beiden Kontinente auf der großen Karte (Pixelraum).
 * Die Koordinaten aus dem Addon sind auf die jeweilige Kontinentkarte
 * normalisiert (0..1), wie die Weltkarte im Spiel.
 */
const W = 1002;
const H = 668;
const GAP = 40;
export const CONTINENTS = {
  K: { name: 'Kalimdor', file: 'kalimdor', x: 0, y: 0, w: W, h: H },
  E: { name: 'Östliche Königreiche', file: 'eastern_kingdoms', x: W + GAP, y: 0, w: W, h: H },
};
export const WORLD = { w: W * 2 + GAP, h: H };

/** Kontinent-Koordinaten (0..1) → Leaflet LatLng im CRS.Simple. */
export function toLatLng(pos) {
  const c = CONTINENTS[pos.c];
  return [-(c.y + pos.y * c.h), c.x + pos.x * c.w];
}

export function timeAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `vor ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} h`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

export const fmt = (n) => Math.round(n).toLocaleString('de-DE');
