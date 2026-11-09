// Pixel-Protokoll zwischen Addon (GuildMapLive.lua) und Companion.
// Streifen: [Marker magenta][Marker grün][DATA_BLOCKS Datenblöcke]
// Jeder Datenblock trägt 3 Nibbles (R,G,B = nibble*16+8), das verträgt ±7 Farbabweichung.
// Bytestrom: 0xA5, seq, len, sumLo, sumHi, xor, payload[len]
export const BLOCK = 4;
export const DATA_BLOCKS = 140;
export const TOTAL_BLOCKS = DATA_BLOCKS + 2;
export const MAX_PAYLOAD = Math.floor((DATA_BLOCKS * 3) / 2) - 6;

/** Für Tests: erzeugt die Blockfarben genau wie das Addon. */
export function encode(payloadStr, seq) {
  let payload = Buffer.from(payloadStr, 'utf8').subarray(0, MAX_PAYLOAD);
  let sum = 0;
  let xr = 0;
  for (const b of payload) {
    sum += b;
    xr ^= b;
  }
  const bytes = [0xa5, seq & 255, payload.length, sum % 256, Math.floor(sum / 256) % 256, xr, ...payload];
  const nib = bytes.flatMap((b) => [b >> 4, b & 15]);
  const blocks = [
    [255, 0, 255],
    [0, 255, 0],
  ];
  for (let k = 0; k < DATA_BLOCKS; k++) {
    blocks.push([0, 1, 2].map((j) => (nib[k * 3 + j] ?? 0) * 16 + 8));
  }
  return blocks;
}

/** Dekodiert einen Frame (Array von [r,g,b]). Gibt {seq, payload} oder null zurück. */
export function decode(blocks) {
  if (blocks.length < TOTAL_BLOCKS) return null;
  const near = (c, t) => c.every((v, i) => Math.abs(v - t[i]) < 48);
  if (!near(blocks[0], [255, 0, 255]) || !near(blocks[1], [0, 255, 0])) return null;
  const nib = [];
  for (let k = 2; k < TOTAL_BLOCKS; k++) for (const v of blocks[k]) nib.push(Math.min(15, v >> 4));
  const bytes = [];
  for (let i = 0; i + 1 < nib.length; i += 2) bytes.push((nib[i] << 4) | nib[i + 1]);
  const [magic, seq, len, sumLo, sumHi, xr] = bytes;
  if (magic !== 0xa5 || len > MAX_PAYLOAD) return null;
  const payload = Buffer.from(bytes.slice(6, 6 + len));
  let sum = 0;
  let x = 0;
  for (const b of payload) {
    sum += b;
    x ^= b;
  }
  if (sum % 256 !== sumLo || Math.floor(sum / 256) % 256 !== sumHi || x !== xr) return null;
  return { seq, payload: payload.toString('utf8') };
}

/** Datensatz aus dem Addon → Objekt für /api/ingest. */
export function parseRecord(text) {
  const f = text.split('|');
  if (f.length < 13) return null;
  const [name, cls, level, xp, xpMax, rested, zone, online, hasAddon, cont, x, y, posAge] = f;
  if (!name) return null;
  const rec = {
    name,
    class: cls || undefined,
    level: Number(level) || undefined,
    zone: zone || undefined,
    online: online === '1',
    hasAddon: hasAddon === '1',
  };
  if (rec.hasAddon) Object.assign(rec, { xp: Number(xp), xpMax: Number(xpMax), rested: Number(rested) });
  if (rec.online) {
    rec.pos = cont === 'K' || cont === 'E' ? { c: cont, x: Number(x) / 10000, y: Number(y) / 10000 } : null;
    if (rec.pos) rec.posAge = Number(posAge) || 0;
  }
  return rec;
}
