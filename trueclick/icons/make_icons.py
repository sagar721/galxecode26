#!/usr/bin/env python3
"""
Generates placeholder TrueClick toolbar icons at 16/32/48/128 px.

Flat geometric: an ink arrow-cursor with a small alert-coloured check, sitting
on a fixed light neutral plate (rounded square) so the mark reads clearly on
both light and dark Chrome toolbar themes (Chrome gives no way to detect the
toolbar theme, so the plate is unconditional).

No third-party libs — raw PNG via zlib. Re-run only to regenerate the PNGs.
"""
import struct, zlib

INK = (0x14, 0x18, 0x1F, 255)     # --tc-ink
ALERT = (0xB8, 0x45, 0x2E, 255)   # --tc-alert
PLATE = (0xF7, 0xF5, 0xF0, 255)   # --tc-paper (fixed light plate)
CLEAR = (0, 0, 0, 0)

GRID = 24.0

# Rounded-square plate, in grid units.
PLATE_X0, PLATE_Y0, PLATE_X1, PLATE_Y1 = 1.0, 1.0, 23.0, 23.0
PLATE_R = 5.0

# Arrow-cursor + check defined on the 24-grid, then scaled/shifted to sit
# comfortably inside the plate margins.
MARK_SCALE = 0.78
MARK_DX, MARK_DY = 2.7, 2.4

_CURSOR_BASE = [
    (2.6, 1.8), (2.6, 18.6), (6.7, 14.7), (9.1, 21.0),
    (11.2, 20.1), (8.9, 14.0), (14.4, 14.0),
]
_CHECK_BASE = [(14.6, 9.4), (16.7, 11.6), (21.6, 5.9)]
_CHECK_HALFW_BASE = 1.45


def _xf(pt):
    return (pt[0] * MARK_SCALE + MARK_DX, pt[1] * MARK_SCALE + MARK_DY)


CURSOR = [_xf(p) for p in _CURSOR_BASE]
CHECK = [_xf(p) for p in _CHECK_BASE]
CHECK_HALFW = _CHECK_HALFW_BASE * MARK_SCALE


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xint = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xint:
                inside = not inside
        j = i
    return inside


def dist_to_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def near_check(x, y):
    for i in range(len(CHECK) - 1):
        ax, ay = CHECK[i]
        bx, by = CHECK[i + 1]
        if dist_to_seg(x, y, ax, ay, bx, by) <= CHECK_HALFW:
            return True
    return False


def sample(gx, gy):
    """Top-to-bottom: check, then cursor, then plate, then transparent."""
    if in_round_rect(gx, gy, PLATE_X0, PLATE_Y0, PLATE_X1, PLATE_Y1, PLATE_R):
        if near_check(gx, gy):
            return ALERT
        if in_poly(gx, gy, CURSOR):
            return INK
        return PLATE
    return CLEAR


def render(size):
    ss = 4  # supersample for slightly cleaner edges
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            ai = 0.0
            r = g = b = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    gx = ((px + (sx + 0.5) / ss) / size) * GRID
                    gy = ((py + (sy + 0.5) / ss) / size) * GRID
                    col = sample(gx, gy)
                    r += col[0]; g += col[1]; b += col[2]; ai += col[3]
            n = ss * ss
            a = ai / n
            if a > 0:
                # un-premultiply the averaged colour
                r = r / n * 255 / a
                g = g / n * 255 / a
                b = b / n * 255 / a
            row += bytes((int(r + 0.5), int(g + 0.5), int(b + 0.5), int(a + 0.5)))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, size)


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 32, 48, 128):
        write_png(os.path.join(here, f"icon{s}.png"), s)
