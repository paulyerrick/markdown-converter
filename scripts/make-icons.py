"""Draw the app icon and menu bar template icon.

Run: python3 scripts/make-icons.py  (needs Pillow; macOS iconutil for the .icns)
Outputs build/icon.icns, build/icon.png, assets/iconTemplate.png, assets/iconTemplate@2x.png.
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PURPLE = (108, 78, 190, 255)
SS = 4  # supersampling factor


def document(draw, box, fill, knockout):
    """Filled page with a folded top-right corner and MD letters knocked out."""
    x0, y0, x1, y1 = box
    w = x1 - x0
    r = w * 0.12   # outer corner radius
    fold = w * 0.30
    draw.rounded_rectangle(box, radius=r, fill=fill)
    # Cut the corner diagonally, then outline the folded flap with a gap.
    draw.polygon([(x1 - fold, y0 - 2), (x1 + 2, y0 - 2), (x1 + 2, y0 + fold)], fill=knockout)
    g = w * 0.06
    fx, fy = x1 - fold, y0 + fold
    draw.line([(fx, y0 - 2), (fx, fy), (x1 + 2, fy)], fill=knockout, width=round(g), joint='curve')
    draw.polygon([(fx + g * 0.5, y0 + g * 1.2), (x1 - g * 1.2, fy - g * 0.5), (fx + g * 0.5, fy - g * 0.5)], fill=fill)

    # "MD" drawn as rounded strokes, so no font is embedded in the icon.
    s = w * 0.085           # stroke width
    ty0 = y0 + (y1 - y0) * 0.52
    ty1 = y0 + (y1 - y0) * 0.80
    mw = w * 0.33
    gap = w * 0.13
    dw = w * 0.22
    lx0 = (x0 + x1) / 2 - (mw + gap + dw) / 2

    def line(points):
        draw.line(points, fill=knockout, width=round(s), joint='curve')
        for px, py in (points[0], points[-1]):
            draw.ellipse((px - s / 2, py - s / 2, px + s / 2, py + s / 2), fill=knockout)

    mx1 = lx0 + mw
    line([(lx0, ty1), (lx0, ty0), (lx0 + mw / 2, ty0 + (ty1 - ty0) * 0.55), (mx1, ty0), (mx1, ty1)])
    for px, py in ((lx0, ty0), (lx0 + mw / 2, ty0 + (ty1 - ty0) * 0.55), (mx1, ty0)):
        draw.ellipse((px - s / 2, py - s / 2, px + s / 2, py + s / 2), fill=knockout)

    dx0 = mx1 + gap
    dx1 = dx0 + dw
    h = ty1 - ty0
    line([(dx0, ty0), (dx0, ty1)])
    draw.arc((dx1 - h * 0.9 - s / 2, ty0 - s / 2, dx1 + s / 2, ty1 + s / 2), 270, 90, fill=knockout, width=round(s))
    line([(dx0, ty0), (dx1 - h * 0.45, ty0)])
    line([(dx0, ty1), (dx1 - h * 0.45, ty1)])


def app_icon(size=1024):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # Apple's macOS icon grid: 824/1024 body, 100px margin, ~185px corner radius.
    m = S * 100 / 1024
    body = (m, m, S - m, S - m)
    radius = S * 185.4 / 1024

    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (m, m + S * 12 / 1024, S - m, S - m + S * 12 / 1024), radius=radius, fill=(30, 20, 60, 70))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(S * 14 / 1024)))

    tile = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rounded_rectangle(body, radius=radius, fill=(226, 221, 240, 255))
    b = S * 5 / 1024
    td.rounded_rectangle((m + b, m + b, S - m - b, S - m - b), radius=radius - b, fill=(255, 255, 255, 255))

    glyph = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gw = S * 0.40
    gh = gw * 1.25
    cx, cy = S / 2, S / 2
    document(ImageDraw.Draw(glyph), (cx - gw / 2, cy - gh / 2, cx + gw / 2, cy + gh / 2),
             fill=PURPLE, knockout=(0, 0, 0, 0))
    tile = Image.alpha_composite(tile, glyph)
    img = Image.alpha_composite(img, tile)
    return img.resize((size, size), Image.LANCZOS)


def template_icon(size):
    S = size * SS * 2
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gh = S * 0.94
    gw = gh / 1.25
    cx, cy = S / 2, S / 2
    document(ImageDraw.Draw(img), (cx - gw / 2, cy - gh / 2, cx + gw / 2, cy + gh / 2),
             fill=(0, 0, 0, 255), knockout=(0, 0, 0, 0))
    return img.resize((size, size), Image.LANCZOS)


def main():
    build = os.path.join(ROOT, 'build')
    os.makedirs(build, exist_ok=True)
    master = app_icon(1024)
    master.save(os.path.join(build, 'icon.png'))

    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'icon.iconset')
        os.makedirs(iconset)
        for pt in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                px = pt * scale
                name = f'icon_{pt}x{pt}' + ('@2x' if scale == 2 else '') + '.png'
                master.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(build, 'icon.icns')], check=True)

    assets = os.path.join(ROOT, 'assets')
    template_icon(18).save(os.path.join(assets, 'iconTemplate.png'))
    template_icon(36).save(os.path.join(assets, 'iconTemplate@2x.png'))


if __name__ == '__main__':
    main()
