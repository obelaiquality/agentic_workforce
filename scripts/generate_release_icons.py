#!/usr/bin/env python3

from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BUILD_RESOURCES = ROOT / "build-resources"
ICONSET_DIR = BUILD_RESOURCES / "icon.iconset"


def rounded_gradient(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    center = (size - 1) / 2

    for y in range(size):
        for x in range(size):
            dx = (x - center) / size
            dy = (y - center) / size
            radius = math.sqrt(dx * dx + dy * dy)
            edge = min(max((radius - 0.10) / 0.62, 0), 1)

            top = (8, 16, 40)
            bottom = (10, 84, 96)
            mix = min(max(y / (size - 1), 0), 1)
            base = tuple(int(top[i] * (1 - mix) + bottom[i] * mix) for i in range(3))

            cyan = (39, 240, 219)
            magenta = (240, 74, 163)
            accent = min(max((0.55 - radius) / 0.55, 0), 1)
            color = tuple(
                int(base[i] * (1 - accent * 0.28) + cyan[i] * accent * 0.18 + magenta[i] * accent * 0.10)
                for i in range(3)
            )
            alpha = int(255 * (1 - edge**2))
            pixels[x, y] = (*color, alpha)

    mask = Image.new("L", (size, size), 0)
    inset = max(1, round(size * 0.035))
    radius = round(size * 0.22)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=255)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return image


def add_glow(base: Image.Image, shape_fn, fill, blur_radius: int) -> None:
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shape_fn(ImageDraw.Draw(glow), fill)
    blurred = glow.filter(ImageFilter.GaussianBlur(blur_radius))
    base.alpha_composite(blurred)


def draw_icon(size: int) -> Image.Image:
    canvas = rounded_gradient(size)
    draw = ImageDraw.Draw(canvas)

    left = size * 0.38
    right = size * 0.62
    apex_y = size * 0.14
    shoulder_y = size * 0.33
    foot_y = size * 0.82
    center_x = size * 0.50

    obelisk_left = [
        (center_x, shoulder_y),
        (left, shoulder_y),
        (size * 0.31, foot_y),
        (center_x, size * 0.89),
    ]
    obelisk_right = [
        (center_x, shoulder_y),
        (right, shoulder_y),
        (size * 0.69, foot_y),
        (center_x, size * 0.89),
    ]
    apex_left = [(center_x, apex_y), (size * 0.39, size * 0.26), (center_x, shoulder_y)]
    apex_right = [(center_x, apex_y), (size * 0.61, size * 0.26), (center_x, shoulder_y)]

    def obelisk_shape(layer: ImageDraw.ImageDraw, fill) -> None:
        layer.polygon(obelisk_left, fill=fill)
        layer.polygon(obelisk_right, fill=fill)
        layer.polygon(apex_left, fill=fill)
        layer.polygon(apex_right, fill=fill)

    add_glow(canvas, obelisk_shape, (42, 233, 223, 110), max(6, size // 36))

    draw.polygon(obelisk_left, fill=(18, 13, 42, 255), outline=(106, 191, 210, 255), width=max(2, size // 192))
    draw.polygon(obelisk_right, fill=(34, 23, 75, 255), outline=(106, 191, 210, 255), width=max(2, size // 192))
    draw.polygon(apex_left, fill=(44, 244, 233, 255), outline=(120, 255, 248, 255))
    draw.polygon(apex_right, fill=(19, 193, 187, 255), outline=(120, 255, 248, 255))

    ring_box_outer = (size * 0.17, size * 0.62, size * 0.83, size * 0.86)
    ring_box_inner = (size * 0.24, size * 0.68, size * 0.76, size * 0.84)
    ring_width = max(3, size // 96)
    draw.arc(ring_box_outer, start=205, end=338, fill=(80, 245, 232, 230), width=ring_width)
    draw.arc(ring_box_outer, start=24, end=160, fill=(80, 245, 232, 140), width=ring_width)
    draw.arc(ring_box_inner, start=215, end=332, fill=(233, 72, 153, 220), width=ring_width)
    draw.arc(ring_box_inner, start=32, end=145, fill=(233, 72, 153, 120), width=ring_width)

    for start, end, color, width in [
        ((size * 0.40, size * 0.78), (size * 0.45, shoulder_y), (237, 76, 155, 210), max(2, size // 170)),
        ((size * 0.50, size * 0.82), (size * 0.50, shoulder_y + size * 0.01), (72, 232, 226, 185), max(2, size // 180)),
        ((size * 0.60, size * 0.78), (size * 0.55, shoulder_y), (237, 76, 155, 210), max(2, size // 170)),
    ]:
        draw.line([start, end], fill=color, width=width)

    core_radius = size * 0.038
    add_glow(
        canvas,
        lambda layer, fill: layer.ellipse(
            (center_x - core_radius * 1.8, size * 0.27 - core_radius * 1.8, center_x + core_radius * 1.8, size * 0.27 + core_radius * 1.8),
            fill=fill,
        ),
        (46, 241, 231, 180),
        max(8, size // 24),
    )
    draw.line((center_x, size * 0.22, center_x, shoulder_y), fill=(80, 245, 232, 150), width=max(2, size // 170))
    draw.ellipse(
        (center_x - core_radius, size * 0.27 - core_radius, center_x + core_radius, size * 0.27 + core_radius),
        fill=(235, 255, 255, 255),
        outline=(44, 244, 233, 255),
        width=max(2, size // 240),
    )

    border = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    inset = max(1, round(size * 0.035))
    border_draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=round(size * 0.22),
        outline=(160, 230, 234, 90),
        width=max(2, size // 180),
    )
    canvas.alpha_composite(border)
    return canvas


def save_pngs(base_image: Image.Image) -> None:
    BUILD_RESOURCES.mkdir(parents=True, exist_ok=True)
    base_image.save(BUILD_RESOURCES / "icon.png")

    ICONSET_DIR.mkdir(parents=True, exist_ok=True)
    sizes = [16, 32, 64, 128, 256, 512]
    for size in sizes:
        icon = base_image.resize((size, size), Image.LANCZOS)
        icon.save(ICONSET_DIR / f"icon_{size}x{size}.png")
        icon_2x = base_image.resize((size * 2, size * 2), Image.LANCZOS)
        icon_2x.save(ICONSET_DIR / f"icon_{size}x{size}@2x.png")


def save_ico(base_image: Image.Image) -> None:
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base_image.save(BUILD_RESOURCES / "icon.ico", sizes=sizes)


def save_icns() -> None:
    if shutil.which("iconutil") is None:
        raise RuntimeError("iconutil is required to generate icon.icns on macOS.")

    output = BUILD_RESOURCES / "icon.icns"
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET_DIR), "-o", str(output)], check=True)


def main() -> None:
    base = draw_icon(1024)
    save_pngs(base)
    save_ico(base)
    save_icns()


if __name__ == "__main__":
    main()
