import fs from 'node:fs';
import path from 'node:path';

const MAX_LEVEL = 60;
const VALID_CONT = new Set(['K', 'E']); // K = Kalimdor, E = Eastern Kingdoms (Östliche Königreiche)

/**
 * Hält den Zustand aller Gildenmitglieder im Speicher und schreibt ihn
 * regelmäßig nach data/state.json, damit Level/XP einen Neustart überleben.
 */
export class GuildState {
  constructor(file) {
    this.file = file;
    this.members = new Map();
    this.listeners = new Set();
    this.dirty = false;
    this.load();
    setInterval(() => this.save(), 10_000).unref();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const m of raw.members ?? []) this.members.set(m.name, { ...m, online: false });
    } catch {
      /* noch keine Datei */
    }
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ members: [...this.members.values()] }, null, 1));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.dirty = true;
    for (const fn of this.listeners) fn();
  }

  snapshot() {
    return { serverTime: Date.now(), maxLevel: MAX_LEVEL, members: [...this.members.values()] };
  }

  /** Übernimmt (teilweise) Datensätze vom Companion oder vom Demo-Simulator. */
  ingest(records) {
    const now = Date.now();
    let changed = 0;
    for (const rec of records) {
      const clean = sanitize(rec);
      if (!clean) continue;
      const prev = this.members.get(clean.name) ?? { name: clean.name, hasAddon: false, pos: null };
      const next = { ...prev, ...clean, lastSeen: now };
      if ('pos' in clean) next.posUpdatedAt = clean.pos ? now - (clean.posAge ?? 0) * 1000 : prev.posUpdatedAt;
      delete next.posAge;
      this.members.set(clean.name, next);
      changed++;
    }
    if (changed) this.emit();
    return changed;
  }

  /** Mitglieder, von denen lange nichts kam, als offline markieren. */
  expire(maxAgeMs) {
    const now = Date.now();
    let changed = false;
    for (const m of this.members.values()) {
      if (m.online && now - (m.lastSeen ?? 0) > maxAgeMs) {
        m.online = false;
        changed = true;
      }
    }
    if (changed) this.emit();
  }
}

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const str = (v, len) => (typeof v === 'string' ? v.slice(0, len) : undefined);

function sanitize(rec) {
  const name = str(rec?.name, 48)?.trim();
  if (!name) return null;
  const out = { name };
  const fields = {
    class: str(rec.class, 16)?.toUpperCase(),
    level: num(rec.level, 1, MAX_LEVEL),
    xp: num(rec.xp, 0, 1e7),
    xpMax: num(rec.xpMax, 0, 1e7),
    rested: num(rec.rested, 0, 1e7),
    zone: str(rec.zone, 64),
    online: typeof rec.online === 'boolean' ? rec.online : undefined,
    hasAddon: typeof rec.hasAddon === 'boolean' ? rec.hasAddon : undefined,
    posAge: num(rec.posAge, 0, 3600),
  };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  if ('pos' in rec) {
    const p = rec.pos;
    out.pos =
      p && VALID_CONT.has(p.c) && num(p.x, 0, 1) !== undefined && num(p.y, 0, 1) !== undefined
        ? { c: p.c, x: num(p.x, 0, 1), y: num(p.y, 0, 1) }
        : null;
  }
  return out;
}
