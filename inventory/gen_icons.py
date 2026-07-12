#!/usr/bin/env python3
"""Generate Tool Inventory PWA icons (a gear on a blue→green badge). No deps."""
import struct, zlib, os, math

OUT = os.path.join(os.path.dirname(__file__), "icons")
BG_TOP = (91, 140, 255)   # --brand  #5b8cff
BG_BOT = (71, 209, 143)   # --brand-2 #47d18f
GLYPH = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded(x, y, w, h, r, px, py):
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    if x <= px <= x + w and y <= py <= y + h:
        if (px < x + r or px > x + w - r) and (py < y + r or py > y + h - r):
            return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
        return True
    return False


def draw(size, maskable=False):
    ss = 4
    S = size * ss
    pad = int(S * (0.18 if maskable else 0.09))
    rr = int(S * 0.22)
    buf = bytearray(S * S * 4)
    ix, iy = pad, pad
    iw = ih = S - 2 * pad
    cx = ix + iw / 2.0
    cy = iy + ih / 2.0
    R = iw * 0.34          # tooth tip radius
    Rin = iw * 0.265       # gear body radius
    hole = iw * 0.12       # center hole
    teeth = 8
    tw = 0.42              # fraction of each sector taken by a tooth
    for j in range(S):
        for i in range(S):
            if not rounded(ix, iy, iw, ih, rr, i, j):
                continue
            t = (j - iy) / ih
            col = lerp(BG_TOP, BG_BOT, max(0.0, min(1.0, t)))
            dx = i - cx
            dy = j - cy
            d = math.hypot(dx, dy)
            glyph = False
            if hole < d <= R:
                ang = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)  # 0..1
                sect = (ang * teeth) % 1.0
                on_tooth = sect < tw
                if d <= Rin:
                    glyph = True
                elif on_tooth and d <= R:
                    glyph = True
            if glyph:
                col = GLYPH
            idx = (j * S + i) * 4
            buf[idx] = col[0]; buf[idx + 1] = col[1]; buf[idx + 2] = col[2]; buf[idx + 3] = 255

    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(ss):
                for dx in range(ss):
                    s = ((y * ss + dy) * S + (x * ss + dx)) * 4
                    r += buf[s]; g += buf[s + 1]; b += buf[s + 2]; a += buf[s + 3]
            n = ss * ss
            o = (y * size + x) * 4
            out[o] = r // n; out[o + 1] = g // n; out[o + 2] = b // n; out[o + 3] = a // n
    return bytes(out)


def write_png(path, size, rgba):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw.extend(rgba[y * size * 4:(y + 1) * size * 4])
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, mask in [("icon-192.png", 192, False), ("icon-512.png", 512, False),
                             ("icon-maskable-512.png", 512, True), ("favicon-64.png", 64, False)]:
        write_png(os.path.join(OUT, name), size, draw(size, mask))
        print("wrote", name)


if __name__ == "__main__":
    main()
