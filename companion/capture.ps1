# Liest den Pixel-Streifen des Addons vom Bildschirm (Windows).
# Ausgabe pro Zeile:  NOMARKER | FOUND x y | F <rrggbb je Block>
param(
  [int]$BlockSize = 4,
  [int]$Blocks = 142,
  [int]$IntervalMs = 40
)
$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class GuildMapPixelReader {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);

  static bool Near(byte[] b, int i, int r, int g, int bl) {
    return Math.Abs(b[i + 2] - r) < 48 && Math.Abs(b[i + 1] - g) < 48 && Math.Abs(b[i] - bl) < 48;
  }

  static byte[] Grab(int x, int y, int w, int h, out int stride) {
    using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
      var d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      stride = d.Stride;
      var buf = new byte[stride * h];
      Marshal.Copy(d.Scan0, buf, 0, buf.Length);
      bmp.UnlockBits(d);
      return buf; // BGRA
    }
  }

  static bool Scan(int bs, out int ox, out int oy) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    ox = oy = 0;
    int st;
    var b = Grab(vx, vy, vw, vh, out st);
    for (int y = 0; y < vh; y++)
      for (int x = 0; x + bs < vw; x++) {
        int i = y * st + x * 4;
        if (Near(b, i, 255, 0, 255) && Near(b, i + bs * 4, 0, 255, 0)) { ox = vx + x; oy = vy + y; return true; }
      }
    return false;
  }

  public static void Run(int bs, int blocks, int interval) {
    SetProcessDPIAware();
    var stdout = Console.Out;
    while (true) {
      int ox, oy;
      bool found = false;
      try { found = Scan(bs, out ox, out oy); } catch { ox = oy = 0; }
      if (!found) { stdout.WriteLine("NOMARKER"); stdout.Flush(); Thread.Sleep(2000); continue; }
      stdout.WriteLine("FOUND " + ox + " " + oy); stdout.Flush();
      string last = null;
      int misses = 0;
      int o = 1; // Abtastpunkt innerhalb des Blocks (verträgt 1 px Versatz)
      while (misses < 25) {
        int st;
        byte[] b;
        try { b = Grab(ox, oy, bs * blocks, bs, out st); } catch { misses++; Thread.Sleep(200); continue; }
        if (!Near(b, o * st + o * 4, 255, 0, 255) || !Near(b, o * st + (bs + o) * 4, 0, 255, 0)) {
          misses++; Thread.Sleep(interval); continue;
        }
        misses = 0;
        var sb = new StringBuilder(blocks * 6);
        for (int k = 0; k < blocks; k++) {
          int i = o * st + (k * bs + o) * 4;
          sb.Append(b[i + 2].ToString("x2")).Append(b[i + 1].ToString("x2")).Append(b[i].ToString("x2"));
        }
        var s = sb.ToString();
        if (s != last) { stdout.WriteLine("F " + s); stdout.Flush(); last = s; }
        Thread.Sleep(interval);
      }
      stdout.WriteLine("LOST"); stdout.Flush();
    }
  }
}
"@

[GuildMapPixelReader]::Run($BlockSize, $Blocks, $IntervalMs)
