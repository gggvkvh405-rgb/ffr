#!/usr/bin/env python3
"""Render the ByAzen app icon (PNG + multi-size ICO) with Pillow only.

Usage: python3 scripts/make-icon.py
Requires: pillow
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

S = 2048  # supersampled canvas
UNIT = S / 1024.0


def u(value: float) -> float:
    return value * UNIT


def build_icon() -> Image.Image:
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Rounded-square silhouette filled with a soft vertical gradient.
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [u(20), u(20), u(1004), u(1004)], radius=u(224), fill=255
    )

    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(base)
    top = (20, 22, 26)
    bottom = (7, 8, 10)
    for y in range(S):
        t = y / (S - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        bd.line([(0, y), (S, y)], fill=color + (255,))
    canvas.paste(base, (0, 0), mask)

    # Accent glow in the upper-left corner.
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gx, gy, gr = u(250), u(140), u(760)
    steps = 90
    for i in range(steps, 0, -1):
        t = i / steps
        r = gr * t
        alpha = int(52 * (1 - t) ** 2.1)
        if alpha <= 0:
            continue
        gd.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(217, 242, 124, alpha))
    canvas.alpha_composite(Image.composite(glow, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

    draw = ImageDraw.Draw(canvas)

    # Hairline highlight around the tile.
    draw.rounded_rectangle(
        [u(21.5), u(21.5), u(1002.5), u(1002.5)],
        radius=u(223),
        outline=(255, 255, 255, 30),
        width=max(1, round(u(3))),
    )

    # Compass ring — same proportions as the in-app logo (24-unit viewBox, r 9.1, stroke 1.3).
    ring_radius = u(374.0)
    ring_width = max(2, round(u(50.0)))
    draw.ellipse(
        [u(512) - ring_radius, u(512) - ring_radius, u(512) + ring_radius, u(512) + ring_radius],
        outline=(233, 230, 222, 96),
        width=ring_width,
    )

    # Needle — the same "V" as the logo mark.
    draw.polygon(
        [(u(655.0), u(369.0)), (u(548.0), u(548.0)), (u(369.0), u(655.0)), (u(476.0), u(476.0))],
        fill=(217, 242, 124, 255),
    )

    return canvas


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "assets")
    os.makedirs(assets, exist_ok=True)

    icon = build_icon()
    icon.resize((1024, 1024), Image.LANCZOS).save(os.path.join(assets, "icon-1024.png"))
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(assets, "icon-512.png"))

    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [icon.resize((size, size), Image.LANCZOS) for size in sizes]
    frames[-1].save(
        os.path.join(assets, "byazen.ico"),
        format="ICO",
        sizes=[(size, size) for size in sizes],
        append_images=frames[:-1],
    )
    print("icon written:", os.path.getsize(os.path.join(assets, "byazen.ico")), "bytes")


if __name__ == "__main__":
    main()
