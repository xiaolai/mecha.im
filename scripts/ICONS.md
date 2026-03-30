# Mecha Icons — Mr.White

## Sprite

**Mr.White** — 11x12 pixel art character on a 32x32 canvas at 2x scale.
- Body color: `#C56F52`
- Eye color: `#ffffff`
- Grid values: `0` = transparent, `1` = body, `2` = eyes

## Script

```
scripts/mecha-icon.py
```

### Requirements

- Python 3.8+
- `Pillow` for PNG generation: `pip install Pillow`

### Quick Start

```sh
# Generate all platform icons (SVG + PNG, transparent bg)
python3 scripts/mecha-icon.py --all --png -o website/images/icons

# Add dark background variants
python3 scripts/mecha-icon.py --all --png-only --bg '#2B2C2B' -o website/images/icons -p mecha-dark

# Base favicon SVG
python3 scripts/mecha-icon.py --svg-only -o website/images/icons -p mecha-favicon
```

### Regenerate All Icons

```sh
# Remove old icons and regenerate everything
rm -f website/images/icons/mecha-*.png website/images/icons/mecha-*.svg

python3 scripts/mecha-icon.py --all --png -o website/images/icons
python3 scripts/mecha-icon.py --all --png-only --bg '#2B2C2B' -o website/images/icons -p mecha-dark
python3 scripts/mecha-icon.py --svg-only -o website/images/icons -p mecha-favicon
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-c` | Body color | `#C56F52` |
| `-e` | Eye color | `#ffffff` |
| `-s` | Comma-separated sizes | `16,32,48,64,128,256,512,1024` |
| `-o` | Output directory | `./mecha-icons` |
| `-p` | Filename prefix | `mecha` |
| `--bg` | Background color | transparent |
| `--radius` | Corner radius ratio | `0` (use `0.2237` for Apple) |
| `--png` | Also generate PNGs | off |
| `--png-only` | Only PNGs | off |
| `--svg-only` | Single base SVG | off |
| `--all` | All platform sizes | off |
| `--platform` | Specific: `favicon,apple,ios,android,web,windows` | - |

### Output Structure

```
website/images/icons/
  mecha-{size}.svg          # Transparent SVG (all platforms)
  mecha-{size}.png          # Transparent PNG (all platforms)
  mecha-dark-{size}.png     # Dark bg (#2B2C2B) PNG
  mecha-favicon.svg         # Base SVG favicon
```

### Sizes by Platform

| Platform | Sizes |
|----------|-------|
| Favicon | 16, 32, 48 |
| Apple macOS | 16, 32, 64, 128, 256, 512, 1024 |
| iOS | 20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024 |
| Android | 36, 48, 72, 96, 144, 192 |
| Web/PWA | 192, 384 |
| Windows | 44, 150, 310 |

### HTML Usage

```html
<!-- Favicon -->
<link rel="icon" type="image/svg+xml" href="/images/icons/mecha-favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/images/icons/mecha-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/images/icons/mecha-16.png">

<!-- Apple Touch -->
<link rel="apple-touch-icon" sizes="180x180" href="/images/icons/mecha-dark-180.png">

<!-- Web Manifest -->
<link rel="manifest" href="/manifest.json">
```
