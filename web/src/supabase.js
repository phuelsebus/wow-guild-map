import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** null, wenn kein Supabase konfiguriert ist (dann nutzt die App den lokalen Server). */
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

export const fromRow = (r) => ({
  name: r.name,
  class: r.class,
  level: r.level,
  xp: r.xp,
  xpMax: r.xp_max,
  rested: r.rested,
  zone: r.zone,
  online: r.online,
  hasAddon: r.has_addon,
  pos: r.pos,
  posUpdatedAt: r.pos_updated_at ? Date.parse(r.pos_updated_at) : null,
  lastSeen: r.last_seen ? Date.parse(r.last_seen) : null,
});
