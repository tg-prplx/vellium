#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
def point(px: float, py: float, pad: int, size: int) -> tuple[int, int]:
    return (
        int(round(pad + (px / 24.0) * size)),
        int(round(pad + (py / 24.0) * size)),
    )


def draw_icon() -> Image.Image:
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Background matches the toolbar mark color.
    draw.rounded_rectangle(
        (48, 48, 976, 976),
        radius=220,
        fill=(217, 119, 87, 255),
    )
    draw.rounded_rectangle(
        (48, 48, 976, 976),
        radius=220,
        outline=(246, 193, 171, 170),
        width=8,
    )

    pad = 208
    size = 608
    p_top = point(12, 2, pad, size)
    p_left = point(2, 7, pad, size)
    p_mid = point(12, 12, pad, size)
    p_right = point(22, 7, pad, size)

    p_l2_left = point(2, 12, pad, size)
    p_l2_mid = point(12, 17, pad, size)
    p_l2_right = point(22, 12, pad, size)

    p_l3_left = point(2, 17, pad, size)
    p_l3_mid = point(12, 22, pad, size)
    p_l3_right = point(22, 17, pad, size)

    # Dark, filled symbol: rhombus + two triangles ("tree" shape).
    fill = (24, 20, 26, 255)
    draw.polygon([p_top, p_left, p_mid, p_right], fill=fill)
    draw.polygon([p_l2_left, p_l2_mid, p_l2_right], fill=fill)
    draw.polygon([p_l3_left, p_l3_mid, p_l3_right], fill=fill)

    return canvas


def generate_ico(base: Image.Image) -> None:
    base.save(
        BUILD_DIR / "icon.ico",
        format="ICO",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)],
    )


def generate_icns(base: Image.Image) -> None:
    base.save(BUILD_DIR / "icon.icns", format="ICNS")


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    base = draw_icon()
    base.save(BUILD_DIR / "icon.png", "PNG")
    generate_icns(base)
    generate_ico(base)
    print(f"Generated icons in {BUILD_DIR}")


if __name__ == "__main__":
    main()
