# Gildenkarte Azeroth

Web-App mit einer großen Karte von Azeroth (Kalimdor + Östliche Königreiche), die die Position aller
Gildenmitglieder live anzeigt. Eine Seitenleiste zeigt Level, aktuelle XP mit Fortschrittsbalken,
Erholungsbonus, Zone und Online-Status.

## Wie die Daten aus dem Spiel kommen

WoW-Addons können weder ins Netz senden noch live Dateien schreiben. Deshalb läuft es so:

```
 Gildenmitglieder (Addon)  ──Addon-Nachrichten (GUILD)──►  Relay-Spieler (Addon, /gmap relay on)
                                                                 │ zeichnet Farbstreifen oben links
                                                                 ▼
                                                  Companion (liest Pixel, Windows)
                                                                 │ RPC ingest_members (mit Token)
                                                                 ▼
                           Supabase (Tabelle + Realtime)  ──►  Web-App auf GitHub Pages
```

Für Entwicklung und Demo gibt es zusätzlich einen lokalen Node-Server (`server/`), der dieselbe
Rolle wie Supabase übernimmt. Die Web-App nutzt Supabase, sobald `VITE_SUPABASE_URL` gesetzt ist.

- **Jedes Mitglied** mit dem Addon sendet alle 5 s Position, Level und XP an die Gilde.
- **Ein Spieler** (der "Relay") schaltet `/gmap relay on` ein. Sein Addon sammelt alles, ergänzt die
  Gildenliste (auch Mitglieder ohne Addon, dann nur Level/Zone) und zeigt die Daten als 568 × 4 Pixel
  großen Farbstreifen oben links an.
- Der **Companion** auf dem PC des Relay liest den Streifen ca. 25-mal pro Sekunde und schickt die
  Daten an den Server. Jeder Frame hat eine Prüfsumme, fehlerhafte werden verworfen.

Ein Mitglied pro 0,2 s: Bei 20 Online-Spielern wird jeder etwa alle 4 s aktualisiert.

## Schnellstart (Demo ohne Spiel)

```bash
npm install
npm run demo
```

Dann http://localhost:5173 öffnen. Es laufen 11 simulierte Mitglieder.

## Live-Betrieb: GitHub Pages + Supabase

### Einmalig einrichten

1. **Supabase:** Im SQL Editor erst `supabase/schema.sql`, dann `supabase/set-token.local.sql`
   ausführen. Die zweite Datei enthält dein geheimes Token und ist von Git ausgenommen.
2. **Companion konfigurieren:** In `companion/config.json` (ebenfalls von Git ausgenommen)
   `supabaseUrl` und `supabaseAnonKey` eintragen (Supabase → Project Settings → API).
   Test ohne Spiel: `node companion/index.js --demo` lädt simulierte Mitglieder hoch.
3. **GitHub:** Repo anlegen und pushen. Unter Settings → Pages als Quelle "GitHub Actions" wählen.
   Unter Settings → Secrets and variables → Actions → **Variables** `SUPABASE_URL` und
   `SUPABASE_ANON_KEY` anlegen. Jeder Push auf `main` veröffentlicht die Seite unter
   `https://<name>.github.io/<repo>/`.

Der Anon-Key ist dafür gedacht, öffentlich im Browser zu stehen: Er darf nur lesen. Schreiben geht
nur über die Funktion `ingest_members` mit dem geheimen Token.

### Beim Spielen

1. **Addon:** Ordner `addon/GuildMapLive` nach `World of Warcraft\_forever_\Interface\AddOns\`
   kopieren. Alle Mitglieder, deren Position/XP sichtbar sein soll, brauchen das Addon.
2. **Im Spiel (Relay-PC):** `/gmap relay on` eingeben. `/gmap` zeigt den Status.
3. **Companion starten** (auf dem Relay-PC):
   ```bash
   node companion/index.js
   ```
   Er meldet "Streifen gefunden bei x y" und dann alle 30 s, wie viele Datensätze er gelesen hat.

Ohne Daten vom Companion gelten alle Mitglieder nach 2 Minuten als offline.

### Alternativ: eigener Server

`npm run build`, dann `INGEST_TOKEN` setzen und `npm start` (Port 3001, `GUILDMAP_PORT` ändert das).
Ohne `supabaseUrl` in der `config.json` schickt der Companion an `--server http://host:3001`.

### Pixel-Leser ohne Spiel testen

Bei laufender Demo `http://localhost:5173/pixeltest.html` in einem sichtbaren Browserfenster öffnen
(Zoom 100 %) und den Companion mit `--token change-me` starten. In der Karte sollte "Thalrok" dann
in Zone "Pixeltest" hin- und herwandern.

### Wenn der Companion den Streifen nicht findet

- WoW muss im Fenster- oder Vollbild-Fenstermodus laufen und sichtbar sein (nicht minimiert).
- Die Benutzeroberfläche darf nicht ausgeblendet sein (Alt+Z).
- HDR, Farbfilter oder Nvidia-Filter können die Farben verfälschen; dann häufen sich "fehlerhafte Frames".

## Karte

Die Kartenbilder sind nicht enthalten (Urheberrecht). Du exportierst sie aus deiner eigenen
WoW-Installation (liest die Spieldaten nur, braucht Python mit Pillow):

```bash
python tools/extract_maps.py "C:\Program Files (x86)\World of Warcraft" --product wowf
```

`--product` ist der Client-Kurzname aus `.build.info` (`wowf` = Forever, `wow_classic_era` = Classic Era).
Das Skript schreibt `web/public/maps/kalimdor.jpg` und `eastern_kingdoms.jpg`.
Die Anordnung der Kontinente steht in `web/src/wow.js` (`CONTINENTS`).

## Projektstruktur

| Ordner | Inhalt |
| --- | --- |
| `addon/GuildMapLive` | WoW-Addon (Lua) |
| `companion` | Pixel-Leser (`capture.ps1`), Protokoll (`protocol.js`), Uploader (`index.js`, `--selftest`) |
| `server` | Express + WebSocket, Zustand in `data/state.json`, Demo-Simulator |
| `web` | React-Frontend mit Leaflet |
| `tools` | `extract_maps.py`: Kartenexport aus der WoW-Installation |

## Hinweis

Das Addon nutzt nur normale Addon-APIs (keine Automatisierung). Der Companion liest nur
Bildschirmpixel. Prüfe trotzdem die Regeln des Servers, auf dem ihr spielt.
