import { useCallback, useMemo, useState } from 'react';
import MapView from './MapView.jsx';
import Sidebar from './Sidebar.jsx';
import { useGuildData, useNow } from './useGuildData.js';

// Kommt so lange nichts vom Companion (z. B. Relay-Spieler ausgeloggt), gilt ein Mitglied als offline.
const OFFLINE_AFTER_MS = 120_000;

export default function App() {
  const { members: raw, maxLevel, connected, serverOffset } = useGuildData();
  const [selected, setSelected] = useState(null);
  const now = useNow() + serverOffset; // Serverzeit, damit Zeitangaben stimmen
  const onSelect = useCallback((name) => setSelected(name), []);

  const tick = Math.floor(now / 5000); // nur alle 5 s neu bewerten
  const members = useMemo(
    () => raw.map((m) => (m.online && now - (m.lastSeen ?? 0) > OFFLINE_AFTER_MS ? { ...m, online: false } : m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, tick],
  );

  return (
    <div className="app">
      <MapView members={members} selected={selected} onSelect={onSelect} now={now} />
      <Sidebar
        members={members}
        maxLevel={maxLevel}
        connected={connected}
        selected={selected}
        onSelect={onSelect}
        now={now}
      />
    </div>
  );
}
