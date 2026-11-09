import { useEffect, useRef, useState } from 'react';
import { supabase, fromRow } from './supabase.js';

const MAX_LEVEL = 60;

/** Live-Daten über Supabase Realtime (GitHub-Pages-Betrieb). */
function useSupabaseData() {
  const [data, setData] = useState({ members: [], maxLevel: MAX_LEVEL, serverOffset: 0 });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let rows = new Map();
    let frame = 0;
    const publish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setData({ members: [...rows.values()], maxLevel: MAX_LEVEL, serverOffset: 0 }));
    };
    const load = async () => {
      const { data: list, error } = await supabase.from('guild_members').select('*');
      if (error) return console.error('Supabase:', error.message);
      rows = new Map(list.map((r) => [r.name, fromRow(r)]));
      publish();
    };

    const channel = supabase
      .channel('guild-members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_members' }, (p) => {
        if (p.eventType === 'DELETE') rows.delete(p.old.name);
        else rows.set(p.new.name, fromRow(p.new));
        publish();
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') load(); // auch nach Wiederverbindung alles neu laden
      });

    return () => {
      cancelAnimationFrame(frame);
      supabase.removeChannel(channel);
    };
  }, []);

  return { ...data, connected };
}

/** Live-Daten über den lokalen Node-Server (Entwicklung / Demo). */
function useServerData() {
  const [data, setData] = useState({ members: [], maxLevel: MAX_LEVEL, serverOffset: 0 });
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    let ws;
    let timer;
    let closed = false;

    const apply = (snap) =>
      setData({ members: snap.members, maxLevel: snap.maxLevel, serverOffset: snap.serverTime - Date.now() });

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => apply(JSON.parse(e.data));
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        const delay = Math.min(10_000, 500 * 2 ** retry.current++);
        timer = setTimeout(connect, delay);
      };
    };

    fetch('/api/state')
      .then((r) => r.json())
      .then(apply)
      .catch(() => {});
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { ...data, connected };
}

export const useGuildData = supabase ? useSupabaseData : useServerData;

/** Re-rendert regelmäßig, damit "vor x s"-Angaben mitlaufen. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
