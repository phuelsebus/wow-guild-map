// Simulierte Gildenmitglieder zum Testen der Oberfläche ohne laufendes Spiel.
// XP-Werte pro Level grob nach Classic (Level 1→2: 400 XP, Level 59→60: ~209.800 XP).
const xpForLevel = (lvl) => Math.round(400 * Math.pow(lvl, 1.35) + lvl * lvl * 25);

const ROSTER = [
  ['Thalrok', 'WARRIOR', 58, 'E', 0.55, 0.62, 'Brennende Steppe'],
  ['Elyndra', 'PRIEST', 42, 'K', 0.52, 0.71, 'Tanaris'],
  ['Morwen', 'MAGE', 60, 'E', 0.6, 0.24, 'Eisenschmiede'],
  ['Kazgul', 'SHAMAN', 23, 'K', 0.57, 0.36, 'Brachland'],
  ['Feyra', 'HUNTER', 35, 'E', 0.45, 0.68, 'Schlingendorntal'],
  ['Grimbald', 'PALADIN', 31, 'E', 0.5, 0.48, 'Arathihochland'],
  ['Shadra', 'ROGUE', 47, 'K', 0.35, 0.58, 'Feralas'],
  ['Nocturne', 'WARLOCK', 12, 'E', 0.43, 0.3, 'Tirisfal'],
  ['Oakhorn', 'DRUID', 54, 'K', 0.62, 0.17, 'Winterquell'],
  ['Brixxa', 'WARRIOR', 19, 'K', 0.62, 0.42, 'Brachland', 'offline'],
  ['Lunara', 'PRIEST', 38, null, 0, 0, 'Scharlachrotes Kloster'],
];

export function startDemo(state) {
  const sim = ROSTER.map(([name, cls, level, c, x, y, zone, flag]) => ({
    name,
    class: cls,
    level,
    xp: Math.round(Math.random() * xpForLevel(level)),
    xpMax: xpForLevel(level),
    rested: Math.random() < 0.5 ? Math.round(Math.random() * xpForLevel(level) * 0.6) : 0,
    zone,
    online: flag !== 'offline',
    hasAddon: name !== 'Brixxa',
    pos: c ? { c, x, y } : null,
    heading: Math.random() * Math.PI * 2,
  }));

  const tick = () => {
    for (const m of sim) {
      if (!m.online || !m.pos) continue;
      m.heading += (Math.random() - 0.5) * 0.6;
      m.pos.x = Math.min(0.95, Math.max(0.05, m.pos.x + Math.cos(m.heading) * 0.0015));
      m.pos.y = Math.min(0.95, Math.max(0.05, m.pos.y + Math.sin(m.heading) * 0.0015));
      if (m.level < 60) {
        m.xp += Math.round(m.xpMax * (0.002 + Math.random() * 0.01));
        if (m.xp >= m.xpMax) {
          m.xp -= m.xpMax;
          m.level++;
          m.xpMax = m.level < 60 ? xpForLevel(m.level) : 0;
          if (m.level === 60) m.xp = 0;
        }
      }
    }
    state.ingest(
      sim.map(({ heading, ...rec }) => ({ ...rec, pos: rec.pos ? { ...rec.pos } : null })),
    );
  };
  tick();
  setInterval(tick, 1000);
}
