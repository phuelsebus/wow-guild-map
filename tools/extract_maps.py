"""
Exportiert die Kontinentkarten (Weltkarte im Spiel) aus einer lokalen WoW-Installation.
Liest das CASC-Archiv nur lesend, verändert nichts am Spiel.

  python tools/extract_maps.py ["C:\\Program Files (x86)\\World of Warcraft"] [--product wowf]

Ergebnis: web/public/maps/kalimdor.jpg und eastern_kingdoms.jpg (1002 x 668, wie im Spiel).
"""
import io
import os
import struct
import sys
import zlib
from pathlib import Path

from PIL import Image

WOW_DIR = Path(next((a for a in sys.argv[1:] if not a.startswith("--")), r"C:\Program Files (x86)\World of Warcraft"))
PRODUCT = sys.argv[sys.argv.index("--product") + 1] if "--product" in sys.argv else "wowf"
OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "maps"

MAPS = {
    "kalimdor": r"INTERFACE\WORLDMAP\KALIMDOR\KALIMDOR{}.BLP",
    "eastern_kingdoms": r"INTERFACE\WORLDMAP\AZEROTH\AZEROTH{}.BLP",
}


# ---------------------------------------------------------------- Jenkins hashlittle2
def _rot(x, k):
    return ((x << k) | (x >> (32 - k))) & 0xFFFFFFFF


def hashlittle2(data: bytes, pc=0, pb=0):
    length = len(data)
    a = b = c = (0xDEADBEEF + length + pc) & 0xFFFFFFFF
    c = (c + pb) & 0xFFFFFFFF
    M = 0xFFFFFFFF

    def mix(a, b, c):
        a = (a - c) & M; a ^= _rot(c, 4);  c = (c + b) & M
        b = (b - a) & M; b ^= _rot(a, 6);  a = (a + c) & M
        c = (c - b) & M; c ^= _rot(b, 8);  b = (b + a) & M
        a = (a - c) & M; a ^= _rot(c, 16); c = (c + b) & M
        b = (b - a) & M; b ^= _rot(a, 19); a = (a + c) & M
        c = (c - b) & M; c ^= _rot(b, 4);  b = (b + a) & M
        return a, b, c

    def final(a, b, c):
        c ^= b; c = (c - _rot(b, 14)) & M
        a ^= c; a = (a - _rot(c, 11)) & M
        b ^= a; b = (b - _rot(a, 25)) & M
        c ^= b; c = (c - _rot(b, 16)) & M
        a ^= c; a = (a - _rot(c, 4)) & M
        b ^= a; b = (b - _rot(a, 14)) & M
        c ^= b; c = (c - _rot(b, 24)) & M
        return a, b, c

    i = 0
    while length > 12:
        x, y, z = struct.unpack_from("<III", data, i)
        a = (a + x) & M; b = (b + y) & M; c = (c + z) & M
        a, b, c = mix(a, b, c)
        i += 12
        length -= 12
    if length == 0:
        return c, b
    tail = data[i:] + b"\0" * (12 - length)
    x, y, z = struct.unpack("<III", tail)
    a = (a + x) & M; b = (b + y) & M; c = (c + z) & M
    a, b, c = final(a, b, c)
    return c, b


def name_hash(path: str) -> int:
    pc, pb = hashlittle2(path.upper().replace("/", "\\").encode())
    return (pc << 32) | pb


# ---------------------------------------------------------------- CASC
def read_build_config():
    lines = (WOW_DIR / ".build.info").read_text().splitlines()
    head = [h.split("!")[0] for h in lines[0].split("|")]
    for line in lines[1:]:
        row = dict(zip(head, line.split("|")))
        if row.get("Product") == PRODUCT:
            key = row["Build Key"]
            break
    else:
        sys.exit(f"Produkt {PRODUCT} nicht in .build.info gefunden")
    cfg = {}
    text = (WOW_DIR / "Data" / "config" / key[:2] / key[2:4] / key).read_text()
    for line in text.splitlines():
        if " = " in line:
            k, v = line.split(" = ", 1)
            cfg[k] = v.split()
    return cfg


def load_indices():
    data_dir = WOW_DIR / "Data" / "data"
    latest = {}
    for f in data_dir.glob("*.idx"):
        bucket, ver = f.stem[:2], int(f.stem[2:], 16)
        if bucket not in latest or ver > latest[bucket][0]:
            latest[bucket] = (ver, f)
    index = {}
    for _, f in latest.values():
        buf = f.read_bytes()
        hsize = struct.unpack_from("<I", buf, 0)[0]
        pos = (8 + hsize + 15) & ~15
        esize = struct.unpack_from("<I", buf, pos)[0]
        pos += 8
        for off in range(pos, pos + esize - 17, 18):
            key = buf[off:off + 9]
            hi = buf[off + 9]
            lo = struct.unpack_from(">I", buf, off + 10)[0]
            archive = (hi << 2) | (lo >> 30)
            offset = lo & 0x3FFFFFFF
            size = struct.unpack_from("<I", buf, off + 14)[0]
            index.setdefault(key, (archive, offset, size))
    return index


def blte_decode(buf: bytes) -> bytes:
    assert buf[:4] == b"BLTE", "kein BLTE"
    hsize = struct.unpack_from(">I", buf, 4)[0]
    if hsize == 0:
        chunks = [(len(buf) - 8, None)]
        pos = 8
    else:
        count = struct.unpack_from(">I", buf, 8)[0] & 0xFFFFFF
        chunks = []
        for i in range(count):
            csize, dsize = struct.unpack_from(">II", buf, 12 + i * 24)
            chunks.append((csize, dsize))
        pos = hsize
    out = bytearray()
    for csize, _ in chunks:
        chunk = buf[pos:pos + csize]
        pos += csize
        mode = chunk[:1]
        if mode == b"N":
            out += chunk[1:]
        elif mode == b"Z":
            out += zlib.decompress(chunk[1:])
        else:
            raise ValueError(f"BLTE-Modus {mode!r} nicht unterstützt")
    return bytes(out)


class Casc:
    def __init__(self):
        self.cfg = read_build_config()
        self.index = load_indices()
        self.data_dir = WOW_DIR / "Data" / "data"
        self.encoding = self.load_encoding()
        self.root = self.load_root()

    def read_ekey(self, ekey: bytes) -> bytes:
        loc = self.index.get(ekey[:9])
        if not loc:
            raise KeyError("Datei nicht lokal vorhanden")
        archive, offset, size = loc
        with open(self.data_dir / f"data.{archive:03d}", "rb") as f:
            f.seek(offset + 30)  # 30 Byte Archiv-Header
            return blte_decode(f.read(size - 30))

    def load_encoding(self):
        buf = self.read_ekey(bytes.fromhex(self.cfg["encoding"][1]))
        assert buf[:2] == b"EN"
        ckey_size, ekey_size = buf[3], buf[4]
        ce_page_kb = struct.unpack_from(">H", buf, 5)[0]
        ce_pages = struct.unpack_from(">I", buf, 9)[0]
        espec_size = struct.unpack_from(">I", buf, 18)[0]
        pos = 22 + espec_size + ce_pages * 32
        enc = {}
        for p in range(ce_pages):
            page_end = pos + ce_page_kb * 1024
            q = pos
            while q + 22 <= page_end:
                n = buf[q]
                if n == 0:
                    break
                ckey = buf[q + 6:q + 6 + ckey_size]
                enc[ckey] = buf[q + 6 + ckey_size:q + 6 + ckey_size + ekey_size]
                q += 6 + ckey_size + ekey_size * n
            pos = page_end
        return enc

    def load_root(self):
        buf = self.read_ekey(self.encoding[bytes.fromhex(self.cfg["root"][0])])
        assert buf[:4] == b"TSFM", "unbekanntes Root-Format"
        a, b = struct.unpack_from("<II", buf, 4)
        version = 1
        if a < 100 and b in (1, 2, 3):  # Header mit Größe und Version
            hsize, version = a, b
            total, named = struct.unpack_from("<II", buf, 12)
            pos = hsize
        else:
            total, named = a, b
            pos = 12
        allow_unnamed = total != named
        root = {}
        while pos < len(buf):
            if version >= 2:
                n, _locale, f1, f2 = struct.unpack_from("<IIII", buf, pos)
                f3 = buf[pos + 16]
                content = f1 | f2 | (f3 << 17)
                pos += 17
            else:
                n, content, _locale = struct.unpack_from("<III", buf, pos)
                pos += 12
            pos += 4 * n  # FileDataID-Deltas
            ckeys_pos = pos
            pos += 16 * n
            has_names = not (allow_unnamed and content & 0x10000000)
            if has_names:
                for i in range(n):
                    h = struct.unpack_from("<Q", buf, pos + i * 8)[0]
                    root.setdefault(h, []).append(buf[ckeys_pos + i * 16:ckeys_pos + i * 16 + 16])
                pos += 8 * n
        return root

    def read(self, path: str) -> bytes:
        ckeys = self.root.get(name_hash(path))
        if not ckeys:
            raise KeyError(f"nicht im Root: {path}")
        # mehrere Varianten (Sprache/Inhalt) möglich: die erste lokal vorhandene nehmen
        for ckey in dict.fromkeys(ckeys):
            ekey = self.encoding.get(ckey)
            if ekey and ekey[:9] in self.index:
                return self.read_ekey(ekey)
        raise KeyError(f"keine Variante lokal installiert: {path}")


def main():
    print(f"Lese CASC aus {WOW_DIR} (Produkt {PRODUCT}) …")
    casc = Casc()
    print(f"  {len(casc.index):,} Index-Einträge, {len(casc.encoding):,} Encoding-Einträge, {len(casc.root):,} benannte Dateien")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for out_name, pattern in MAPS.items():
        canvas = Image.new("RGB", (1024, 768))
        for i in range(12):
            tile = Image.open(io.BytesIO(casc.read(pattern.format(i + 1)))).convert("RGB")
            canvas.paste(tile, ((i % 4) * 256, (i // 4) * 256))
        target = OUT_DIR / f"{out_name}.jpg"
        canvas.crop((0, 0, 1002, 668)).save(target, quality=92)
        print(f"  geschrieben: {target}")


if __name__ == "__main__":
    main()
