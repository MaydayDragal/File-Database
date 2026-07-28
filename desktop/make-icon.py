#!/usr/bin/env python3
"""Build icon.ico (multi-size, PNG-compressed) and icon.png for the desktop app.

Reuses the platform's database-glyph icon renderer from tools/gen_icons.py.
"""
import os
import sys
import struct
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import gen_icons  # noqa: E402  (draw_icon / write_png)

SIZES = [16, 32, 48, 64, 128, 256]


def png_bytes(size):
    rgba = gen_icons.draw_icon(size, maskable=False)
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    gen_icons.write_png(tmp, size, rgba)
    with open(tmp, "rb") as f:
        data = f.read()
    os.remove(tmp)
    return data


def build_ico(path, sizes):
    images = [(s, png_bytes(s)) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))  # reserved, type=1 (icon), count
    offset = 6 + 16 * len(images)
    entries = b""
    blob = b""
    for size, data in images:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        blob += data
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + entries + blob)
    print("wrote", path, "(%d sizes)" % len(images))


def main():
    build_ico(os.path.join(HERE, "icon.ico"), SIZES)
    # A 256px PNG for the Linux/dev window icon.
    with open(os.path.join(HERE, "icon.png"), "wb") as f:
        f.write(png_bytes(256))
    print("wrote", os.path.join(HERE, "icon.png"))


if __name__ == "__main__":
    main()
