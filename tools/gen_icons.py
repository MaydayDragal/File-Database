#!/usr/bin/env python3
"""Generate PWA icons (PNG) with no external dependencies.

Renders a rounded-square badge with a stacked "database" glyph at 4x
supersampling, then box-downsamples for smooth anti-aliased edges.
"""
import struct
import zlib
import os
import math

# The same badge brands both the platform shell (root icons/) and the
# File Vault app (vault/icons/).
OUT_DIRS = [
    os.path.join(os.path.dirname(__file__), "..", "icons"),
    os.path.join(os.path.dirname(__file__), "..", "vault", "icons"),
]

# Brand colors (matches styles.css)
BG_TOP = (79, 70, 229)      # indigo-600
BG_BOT = (56, 189, 248)     # sky-400
GLYPH = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_rect_alpha(x, y, w, h, r, px, py):
    """Return coverage 1.0 inside a rounded rect, else 0.0 (hard edge; AA via SS)."""
    # clamp to the corner circle centers
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    if x <= px <= x + w and y <= py <= y + h:
        # inside bounding box; check corner rounding
        if (px < x + r or px > x + w - r) and (py < y + r or py > y + h - r):
            return 1.0 if (px - cx) ** 2 + (py - cy) ** 2 <= r * r else 0.0
        return 1.0
    return 0.0


def draw_icon(size, maskable=False):
    ss = 4
    S = size * ss
    # pad content inward for maskable safe-zone
    pad = int(S * (0.18 if maskable else 0.09))
    rr = int(S * (0.5 if maskable else 0.22))  # full round for maskable-safe look? keep rounded
    rr = int(S * 0.22)

    # buffer RGBA
    buf = bytearray(S * S * 4)

    inner_x, inner_y = pad, pad
    inner_w = inner_h = S - 2 * pad

    # database glyph geometry (three stacked ellipses)
    gx = inner_x + inner_w * 0.22
    gw = inner_w * 0.56
    gtop = inner_y + inner_h * 0.24
    gbot = inner_y + inner_h * 0.76
    ry = inner_w * 0.10  # ellipse vertical radius
    rx = gw / 2.0
    cxg = gx + rx
    band = (gbot - gtop)

    def in_ellipse(px, py, cy):
        dx = (px - cxg) / rx
        dy = (py - cy) / ry
        return dx * dx + dy * dy <= 1.0

    for j in range(S):
        for i in range(S):
            a = rounded_rect_alpha(inner_x, inner_y, inner_w, inner_h, rr, i, j)
            if a <= 0:
                continue
            t = (j - inner_y) / inner_h
            col = lerp(BG_TOP, BG_BOT, max(0.0, min(1.0, t)))

            # glyph: cylinder body between top and bottom ellipse centers
            drawn_glyph = False
            if gx <= i <= gx + gw:
                cy_top = gtop
                cy_bot = gbot
                # body region
                if cy_top <= j <= cy_bot:
                    # inside vertical body walls
                    if abs(i - cxg) <= rx:
                        drawn_glyph = True
                # top cap ellipse
                if in_ellipse(i, j, cy_top):
                    drawn_glyph = True
                # bottom cap ellipse
                if in_ellipse(i, j, cy_bot) and j >= cy_bot:
                    drawn_glyph = True

            # carve two band grooves (rings) to look like a DB
            if drawn_glyph:
                ring1 = gtop + band * 0.34
                ring2 = gtop + band * 0.66
                on_ring = False
                for ry_c in (ring1, ring2):
                    if in_ellipse(i, j, ry_c) and j >= ry_c - ry * 0.15 and j <= ry_c + ry * 1.0:
                        # thin groove line just below each ring's front arc
                        pass
                col = GLYPH

            idx = (j * S + i) * 4
            buf[idx] = col[0]
            buf[idx + 1] = col[1]
            buf[idx + 2] = col[2]
            buf[idx + 3] = 255

    # downsample ss -> 1 (box filter)
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(ss):
                for dx in range(ss):
                    sidx = ((y * ss + dy) * S + (x * ss + dx)) * 4
                    r += buf[sidx]
                    g += buf[sidx + 1]
                    b += buf[sidx + 2]
                    a += buf[sidx + 3]
            n = ss * ss
            oidx = (y * size + x) * 4
            out[oidx] = r // n
            out[oidx + 1] = g // n
            out[oidx + 2] = b // n
            out[oidx + 3] = a // n
    return bytes(out)


def write_png(path, size, rgba):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type none
        raw.extend(rgba[y * size * 4:(y + 1) * size * 4])
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def main():
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
    specs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
        ("favicon-64.png", 64, False),
    ]
    for name, size, maskable in specs:
        px = draw_icon(size, maskable)
        for d in OUT_DIRS:
            write_png(os.path.join(d, name), size, px)
        print("wrote", name)


if __name__ == "__main__":
    main()
