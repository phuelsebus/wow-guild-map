import { useMemo, useState } from 'react';
import { CONTINENTS, POS_STALE_MS, classColor, className, fmt, timeAgo } from './wow.js';

function XpBar({ m, maxLevel }) {
  if (m.level >= maxLevel) {
    return (
      <div className="xp">
        <div className="xp-bar max">
          <div className="xp-fill" style={{ width: '100%' }} />
        </div>
        <div className="xp-text">Höchststufe erreicht</div>
      </div>
    );
  }
  if (!m.hasAddon || !m.xpMax) {
    return (
      <div className="xp">
        <div className="xp-bar unknown" />
        <div className="xp-text muted">XP unbekannt – kein Addon installiert</div>
      </div>
    );
  }
  const pct = Math.min(100, (m.xp / m.xpMax) * 100);
  const restedPct = Math.min(100 - pct, ((m.rested ?? 0) / m.xpMax) * 100);
  return (
    <div className="xp">
      <div className="xp-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="xp-fill" style={{ width: `${pct}%` }} />
        {restedPct > 0 && <div className="xp-rested" style={{ left: `${pct}%`, width: `${restedPct}%` }} />}
        <span className="xp-pct">{pct.toFixed(1)} %</span>
      </div>
      <div className="xp-text">
        {fmt(m.xp)} / {fmt(m.xpMax)} XP
        {m.rested > 0 && <span className="rested"> · {fmt(m.rested)} erholt</span>}
      </div>
    </div>
  );
}

function status(m, now) {
  if (!m.online) return { cls: 'off', label: m.lastSeen ? `offline · ${timeAgo(now - m.lastSeen)}` : 'offline' };
  if (!m.pos) return { cls: 'inst', label: m.hasAddon ? 'Position unbekannt (Instanz?)' : 'online' };
  if (now - (m.posUpdatedAt ?? 0) > POS_STALE_MS) return { cls: 'stale', label: `Position ${timeAgo(now - m.posUpdatedAt)}` };
  return { cls: 'live', label: `live · ${CONTINENTS[m.pos.c].name}` };
}

export default function Sidebar({ members, maxLevel, connected, selected, onSelect, now }) {
  const [query, setQuery] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => (!onlyOnline || m.online) && (!q || m.name.toLowerCase().includes(q) || m.zone?.toLowerCase().includes(q)))
      .sort((a, b) => b.online - a.online || (b.level ?? 0) - (a.level ?? 0) || (b.xp ?? 0) / (b.xpMax || 1) - (a.xp ?? 0) / (a.xpMax || 1) || a.name.localeCompare(b.name));
  }, [members, query, onlyOnline]);

  const online = members.filter((m) => m.online).length;

  return (
    <aside className="sidebar">
      <header className="sb-head">
        <h1>Gildenkarte</h1>
        <div className="sb-meta">
          <span className={`conn ${connected ? 'ok' : 'bad'}`}>{connected ? 'verbunden' : 'getrennt'}</span>
          <span>
            {online} / {members.length} online
          </span>
        </div>
        <div className="sb-tools">
          <input type="search" placeholder="Name oder Zone suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="toggle">
            <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} />
            nur online
          </label>
        </div>
      </header>

      <ul className="members">
        {list.length === 0 && (
          <li className="empty">
            {members.length === 0 ? 'Noch keine Daten. Läuft der Companion bzw. das Addon?' : 'Keine Treffer.'}
          </li>
        )}
        {list.map((m) => {
          const st = status(m, now);
          return (
            <li key={m.name}>
              <button
                className={`card ${m.online ? '' : 'offline'} ${m.name === selected ? 'selected' : ''}`}
                style={{ '--c': classColor(m.class) }}
                onClick={() => onSelect(m.name === selected ? null : m.name)}
                title={m.pos ? 'Auf Karte zeigen' : undefined}
              >
                <div className="card-top">
                  <span className="lvl">{m.level ?? '?'}</span>
                  <div className="who">
                    <span className="name">{m.name}</span>
                    <span className="sub">
                      {className(m.class)}
                      {m.zone ? ` · ${m.zone}` : ''}
                    </span>
                  </div>
                </div>
                <XpBar m={m} maxLevel={maxLevel} />
                <div className={`status ${st.cls}`}>{st.label}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
