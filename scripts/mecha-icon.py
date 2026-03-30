#!/usr/bin/env python3
"""Generate SVG/PNG icons for Mecha (Mr.White). Run with --help for options."""

import argparse
import os
import sys

# ===== Mr.White sprite data =====
NAME = "Mr.White"
W, H = 11, 12
GRID = [
    [0,0,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,0,0],
    [1,1,1,1,1,1,1,1,1,1,1],
    [0,1,1,2,2,1,2,2,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,0,0],
    [0,0,0,1,1,1,1,1,0,0,0],
    [0,1,0,1,0,1,0,1,0,1,0],
    [0,0,1,0,1,0,1,0,1,0,0],
    [0,1,0,1,0,1,0,1,0,1,0],
]
BODY_COLOR = "#C56F52"
EYE_COLOR = "#ffffff"
CANVAS = 32
SCALE = 2

# Standard icon sizes per platform
SIZES_ALL = {
    "favicon":  [16, 32, 48],
    "apple":    [16, 32, 64, 128, 256, 512, 1024],
    "ios":      [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024],
    "android":  [36, 48, 72, 96, 144, 192],
    "web":      [192, 384],
    "windows":  [44, 150, 310],
}


def build_color_grid(body_color, eye_color):
    result = []
    for row in GRID:
        r = []
        for v in row:
            if v == 0:
                r.append(None)
            elif v == 1:
                r.append(body_color)
            else:
                r.append(eye_color)
        result.append(r)
    return result


def merge_rects(color_grid):
    rects = []
    for y in range(H):
        x = 0
        while x < W:
            c = color_grid[y][x]
            if c is not None:
                x0 = x
                while x < W and color_grid[y][x] == c:
                    x += 1
                rects.append((x0, y, x - x0, 1, c))
            else:
                x += 1
    return rects


def svg(rects, size=None, bg_color=None, bg_radius=0):
    sz = size or CANVAS
    off_x = (CANVAS - W * SCALE) // 2
    off_y = (CANVAS - H * SCALE) // 2

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{sz}" height="{sz}" '
        f'viewBox="0 0 {CANVAS} {CANVAS}" '
        f'shape-rendering="crispEdges">'
    ]

    if bg_color:
        if bg_radius > 0:
            r = round(CANVAS * bg_radius, 2)
            lines.append(f'<rect width="{CANVAS}" height="{CANVAS}" rx="{r}" ry="{r}" fill="{bg_color}"/>')
        else:
            lines.append(f'<rect width="{CANVAS}" height="{CANVAS}" fill="{bg_color}"/>')

    for cx, cy, cw, _, color in rects:
        sx = off_x + cx * SCALE
        sy = off_y + cy * SCALE
        lines.append(f'<rect x="{sx}" y="{sy}" width="{cw * SCALE}" height="{SCALE}" fill="{color}"/>')

    lines.append('</svg>')
    return '\n'.join(lines)


def png(color_grid, size, bg_color=None):
    from PIL import Image
    off_x = (CANVAS - W * SCALE) // 2
    off_y = (CANVAS - H * SCALE) // 2

    img = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))

    if bg_color:
        bg = hex2rgb(bg_color)
        for py in range(CANVAS):
            for px in range(CANVAS):
                img.putpixel((px, py), bg + (255,))

    for y in range(H):
        for x in range(W):
            c = color_grid[y][x]
            if c is None:
                continue
            rgb = hex2rgb(c)
            px = off_x + x * SCALE
            py = off_y + y * SCALE
            for dy in range(SCALE):
                for dx in range(SCALE):
                    if 0 <= px + dx < CANVAS and 0 <= py + dy < CANVAS:
                        img.putpixel((px + dx, py + dy), rgb + (255,))

    if size != CANVAS:
        img = img.resize((size, size), Image.NEAREST)
    return img


def hex2rgb(color):
    c = color.lstrip('#')
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def ensure_hash(c):
    return c if c.startswith('#') else '#' + c


def main():
    p = argparse.ArgumentParser(
        description=f'Generate Mecha ({NAME}) icons',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Sprite: {NAME} ({W}x{H} cells, {CANVAS}x{CANVAS} canvas)
Default body: {BODY_COLOR}, eyes: {EYE_COLOR}

Platform sets (--all):
  favicon:  {SIZES_ALL['favicon']}
  apple:    {SIZES_ALL['apple']}
  ios:      {SIZES_ALL['ios']}
  android:  {SIZES_ALL['android']}
  web:      {SIZES_ALL['web']}
  windows:  {SIZES_ALL['windows']}
""")
    p.add_argument('-c', '--color', default=BODY_COLOR, help=f'Body color (default: {BODY_COLOR})')
    p.add_argument('-e', '--eye-color', default=EYE_COLOR, help=f'Eye color (default: {EYE_COLOR})')
    p.add_argument('-s', '--sizes', default=None, help='Comma-separated sizes (default: 16,32,64,128,256,512,1024)')
    p.add_argument('-o', '--output', default='./mecha-icons', help='Output directory')
    p.add_argument('-p', '--prefix', default='mecha', help='Filename prefix (default: mecha)')
    p.add_argument('--bg', default=None, help='Background color (default: transparent)')
    p.add_argument('--radius', type=float, default=0, help='Corner radius ratio (0.2237 for Apple)')
    p.add_argument('--png', action='store_true', help='Also generate PNGs')
    p.add_argument('--png-only', action='store_true', help='Only generate PNGs')
    p.add_argument('--svg-only', action='store_true', help='Only one base SVG (no size variants)')
    p.add_argument('--all', action='store_true', help='Generate all platform sizes (favicon/apple/ios/android/web/windows)')
    p.add_argument('--platform', default=None, help='Specific platform: favicon,apple,ios,android,web,windows')

    args = p.parse_args()
    body_color = ensure_hash(args.color)
    eye_color = ensure_hash(args.eye_color)
    prefix = args.prefix

    # Determine sizes
    if args.all:
        all_sizes = set()
        for v in SIZES_ALL.values():
            all_sizes.update(v)
        sizes = sorted(all_sizes)
    elif args.platform:
        platforms = [x.strip() for x in args.platform.split(',')]
        all_sizes = set()
        for plat in platforms:
            if plat in SIZES_ALL:
                all_sizes.update(SIZES_ALL[plat])
            else:
                print(f'Unknown platform: {plat}', file=sys.stderr)
        sizes = sorted(all_sizes)
    elif args.sizes:
        sizes = sorted(set(int(s.strip()) for s in args.sizes.split(',')))
    else:
        sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

    os.makedirs(args.output, exist_ok=True)

    color_grid = build_color_grid(body_color, eye_color)
    rects = merge_rects(color_grid)
    count = 0

    if args.svg_only:
        content = svg(rects, bg_color=args.bg, bg_radius=args.radius)
        path = os.path.join(args.output, f'{prefix}.svg')
        with open(path, 'w') as f:
            f.write(content)
        print(f'  {path}')
        count += 1
    else:
        for sz in sizes:
            # SVG
            if not args.png_only:
                content = svg(rects, sz, bg_color=args.bg, bg_radius=args.radius)
                path = os.path.join(args.output, f'{prefix}-{sz}.svg')
                with open(path, 'w') as f:
                    f.write(content)
                print(f'  {path}')
                count += 1

            # PNG
            if args.png or args.png_only:
                try:
                    img = png(color_grid, sz, bg_color=args.bg)
                    path = os.path.join(args.output, f'{prefix}-{sz}.png')
                    img.save(path)
                    print(f'  {path}')
                    count += 1
                except ImportError:
                    print('  [skip PNG] pip install Pillow', file=sys.stderr)
                    break

    print(f'\n{NAME} — {count} files → {args.output}/')
    print(f'  body: {body_color}  eyes: {eye_color}  bg: {args.bg or "transparent"}')


if __name__ == '__main__':
    main()
