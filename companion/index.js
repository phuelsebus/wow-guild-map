// Companion: liest den Pixel-Streifen des Addons vom Bildschirm und schickt die Daten an Supabase
// (oder an den lokalen Server). Einstellungen stehen in companion/config.json.
//
//   node companion/index.js              Bildschirm lesen und hochladen
//   node companion/index.js --demo       simulierte Mitglieder hochladen (Test ohne Spiel)
//   node companion/index.js --selftest   Pixel-Protokoll prüfen
//
// Ohne supabaseUrl in der config.json geht alles an den lokalen Server (--server, Standard http://localhost:3001).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BLOCK, TOTAL_BLOCKS, decode, encode, parseRecord } from './protocol.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FLUSH_MS = 1000;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function loadConfig() {
  let file = {};
  const p = path.join(DIR, 'config.json');
  if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    supabaseUrl: (arg('supabase-url') ?? process.env.SUPABASE_URL ?? file.supabaseUrl ?? '').replace(/\/$/, ''),
    supabaseAnonKey: arg('anon-key') ?? process.env.SUPABASE_ANON_KEY ?? file.supabaseAnonKey ?? '',
    token: arg('token') ?? process.env.INGEST_TOKEN ?? file.token ?? 'change-me',
    server: (arg('server') ?? process.env.SERVER_URL ?? file.server ?? 'http://localhost:3001').replace(/\/$/, ''),
  };
}

/** Liefert eine Funktion, die eine Liste von Datensätzen hochlädt. */
function createUploader(cfg) {
  if (cfg.supabaseUrl) {
    if (!cfg.supabaseAnonKey) throw new Error('supabaseAnonKey fehlt in companion/config.json');
    return {
      target: `Supabase (${cfg.supabaseUrl})`,
      async send(members) {
        const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/ingest_members`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: cfg.supabaseAnonKey,
            // alter anon key ist ein JWT (eyJ…) und gehört auch in Authorization;
            // der neue publishable key (sb_publishable_…) nur in apikey
            ...(cfg.supabaseAnonKey.startsWith('eyJ') ? { authorization: `Bearer ${cfg.supabaseAnonKey}` } : {}),
          },
          body: JSON.stringify({ token: cfg.token, members }),
        });
        if (!res.ok) throw new Error(`Supabase antwortet ${res.status}: ${await res.text()}`);
      },
    };
  }
  return {
    target: `lokaler Server (${cfg.server})`,
    async send(members) {
      const res = await fetch(`${cfg.server}/api/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-token': cfg.token },
        body: JSON.stringify({ members }),
      });
      if (!res.ok) throw new Error(`Server antwortet ${res.status}: ${await res.text()}`);
    },
  };
}

if (process.argv.includes('--selftest')) selftest();
else run();

async function run() {
  const cfg = loadConfig();
  const uploader = createUploader(cfg);
  const pending = new Map();
  let failing = false;

  setInterval(async () => {
    if (!pending.size) return;
    const members = [...pending.values()];
    pending.clear();
    try {
      await uploader.send(members);
      if (failing) console.log('Upload funktioniert wieder.');
      failing = false;
    } catch (e) {
      if (!failing) console.error(`Upload fehlgeschlagen: ${e.message}`);
      failing = true;
      for (const m of members) if (!pending.has(m.name)) pending.set(m.name, m);
    }
  }, FLUSH_MS);

  if (process.argv.includes('--demo')) {
    const { startDemo } = await import('../server/demo.js');
    startDemo({ ingest: (recs) => recs.forEach((r) => pending.set(r.name, r)) });
    console.log(`Demo-Modus: simulierte Mitglieder → ${uploader.target}`);
    return;
  }

  readScreen((rec) => pending.set(rec.name, rec));
  console.log(`Companion läuft. Ziel: ${uploader.target}`);
}

function readScreen(onRecord) {
  let lastSeq = -1;
  let frames = 0;
  let bad = 0;

  const ps = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'capture.ps1'), '-BlockSize', BLOCK, '-Blocks', TOTAL_BLOCKS],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  ps.on('exit', (code) => {
    console.error(`Bildschirm-Leser beendet (Code ${code}).`);
    process.exit(1);
  });
  process.on('SIGINT', () => {
    ps.kill();
    process.exit(0);
  });

  readline.createInterface({ input: ps.stdout }).on('line', (line) => {
    if (line === 'NOMARKER') return console.log('Warte auf Pixel-Streifen… (WoW sichtbar? /gmap relay on?)');
    if (line.startsWith('FOUND')) return console.log(`Streifen gefunden bei ${line.slice(6)}.`);
    if (line === 'LOST') return console.log('Streifen verloren, suche neu…');
    if (!line.startsWith('F ')) return;
    const hex = line.slice(2);
    const blocks = [];
    for (let i = 0; i + 6 <= hex.length; i += 6) {
      blocks.push([0, 2, 4].map((o) => parseInt(hex.slice(i + o, i + o + 2), 16)));
    }
    const frame = decode(blocks);
    if (!frame) return void bad++;
    if (frame.seq === lastSeq) return;
    lastSeq = frame.seq;
    const rec = parseRecord(frame.payload);
    if (!rec) return void bad++;
    frames++;
    onRecord(rec);
  });

  setInterval(() => {
    if (frames || bad) console.log(`${frames} Datensätze gelesen, ${bad} fehlerhafte Frames (letzte 30 s)`);
    frames = bad = 0;
  }, 30_000);
}

function selftest() {
  const sample = 'Thalrok|WARRIOR|58|123456|209800|5000|Brennende Steppe|1|1|E|5512|6203|3';
  const blocks = encode(sample, 7);
  // leichtes Farbrauschen simulieren
  const noisy = blocks.map((c, i) => (i < 2 ? c : c.map((v) => Math.max(0, Math.min(255, v + Math.round(Math.random() * 12 - 6))))));
  const out = decode(noisy);
  console.log('decoded:', out);
  console.log('record :', parseRecord(out.payload));
  const broken = noisy.map((c) => [...c]);
  broken[20][1] += 40;
  console.log('Fehlerhafter Frame wird verworfen:', decode(broken) === null);
  const umlaut = decode(encode('Ælwyn|MAGE|60|0|0|0|Unterstadt|1|1|E|1|2|0', 1));
  console.log('UTF-8:', umlaut.payload);
}
