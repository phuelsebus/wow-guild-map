import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GuildState } from './state.js';
import { startDemo } from './demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GUILDMAP_PORT || 3001);
const TOKEN = process.env.INGEST_TOKEN || 'change-me';
const OFFLINE_AFTER_MS = 120_000;
const DEMO = process.argv.includes('--demo') || process.env.DEMO === '1';

const state = new GuildState(path.join(ROOT, 'data', DEMO ? 'demo-state.json' : 'state.json'));
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/state', (_req, res) => res.json(state.snapshot()));

// Der Companion schickt hier die aus dem Spiel ausgelesenen Daten hin.
app.post('/api/ingest', (req, res) => {
  if (req.get('x-ingest-token') !== TOKEN) return res.status(401).json({ error: 'invalid token' });
  const records = Array.isArray(req.body?.members) ? req.body.members : [req.body];
  res.json({ accepted: state.ingest(records) });
});

// Gebautes Frontend ausliefern (npm run build), im Dev-Modus übernimmt Vite.
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => ws.send(JSON.stringify(state.snapshot())));

// Änderungen gebündelt (max. 4x pro Sekunde) an alle Browser pushen.
let pending = false;
state.onChange(() => {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    const msg = JSON.stringify(state.snapshot());
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  }, 250);
});

setInterval(() => state.expire(OFFLINE_AFTER_MS), 5_000);

server.listen(PORT, () => {
  console.log(`Guild Map Server läuft auf http://localhost:${PORT}`);
  if (TOKEN === 'change-me') console.warn('WARNUNG: INGEST_TOKEN ist nicht gesetzt (Standard "change-me").');
  if (DEMO) {
    console.log('Demo-Modus: simulierte Gildenmitglieder aktiv.');
    startDemo(state);
  }
});
