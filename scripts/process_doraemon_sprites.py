#!/usr/bin/env python3
"""
Slice 2x2 chroma-key (#00FF00) Doraemon character sprite sheets into clean,
despilled RGBA PNG frames with tight centered foot-aligned bounding boxes.
"""

import os
import sys
import numpy as np
from PIL import Image


def chroma_key_rgba(img: Image.Image) -> Image.Image:
    """Remove solid bright green chroma-key background cleanly with green-spill suppression."""
    rgba = img.convert("RGBA")
    arr = np.array(rgba, dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    # Measure "greenness": how much green exceeds the max of red and blue
    max_rb = np.maximum(r, b)
    green_excess = g - max_rb

    # Smooth alpha ramp tuned for pure #00FF00 chroma key + JPEG anti-alias edge
    # Pure green has green_excess ~ 255; dark outlines/characters have <= 25
    alpha = np.clip((72.0 - green_excess) / 42.0, 0.0, 1.0)

    # Protect intentional teal/cyan/yellow highlights where green is high ONLY if
    # blue or red is also substantial (so green_excess stays modest)
    # Also ensure very dark outlines stay opaque
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    is_outline = (luminance < 75.0) & (green_excess < 80.0)
    alpha = np.where(is_outline, 1.0, alpha)

    # Despill: clamp green channel on semi-transparent edge pixels so no green fringe remains
    spill_mask = (green_excess > 15.0) & (alpha > 0.0) & (alpha < 0.99)
    new_g = np.where(spill_mask, np.minimum(g, max_rb + 6.0), g)

    # Slightly despill hard edge boundary pixels too (1px fringe from JPEG)
    strong_green_edge = (green_excess > 35.0) & (alpha >= 0.99) & (g > 140.0) & (max_rb < 110.0)
    new_g = np.where(strong_green_edge, max_rb + 10.0, new_g)

    out = np.zeros_like(arr, dtype=np.uint8)
    out[:, :, 0] = np.clip(r, 0, 255).astype(np.uint8)
    out[:, :, 1] = np.clip(new_g, 0, 255).astype(np.uint8)
    out[:, :, 2] = np.clip(b, 0, 255).astype(np.uint8)
    out[:, :, 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)

    # Remove tiny isolated alpha noise (< 20)
    out[:, :, 3] = np.where(out[:, :, 3] < 24, 0, out[:, :, 3])
    return Image.fromarray(out, mode="RGBA")


def normalize_frame(frame: Image.Image, target_size: int = 320, pad: int = 16) -> Image.Image:
    """Crop tightly to non-transparent content and place foot-aligned on a clean square canvas."""
    bbox = frame.getbbox()
    if not bbox:
        return Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    cropped = frame.crop(bbox)
    cw, ch = cropped.size
    avail = target_size - pad * 2
    scale = min(avail / cw, avail / ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    ox = (target_size - nw) // 2
    oy = target_size - pad - nh  # Bottom (foot) aligned!
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def process_sheet(src_path: str, out_dir: str, char_id: str):
    os.makedirs(out_dir, exist_ok=True)
    img = Image.open(src_path).convert("RGB")
    w, h = img.size
    hw, hh = w // 2, h // 2

    quadrants = {
        "idle": (0, 0, hw, hh),
        "work": (hw, 0, w, hh),
        "walk": (0, hh, hw, h),
        "eureka": (hw, hh, w, h),
    }

    frames = []
    for pose_name, box in quadrants.items():
        quad = img.crop(box)
        rgba = chroma_key_rgba(quad)
        norm = normalize_frame(rgba, target_size=320, pad=14)
        out_path = os.path.join(out_dir, f"{char_id}_{pose_name}.png")
        norm.save(out_path, "PNG")
        frames.append((pose_name, norm))

    # Also write a 1x4 horizontal contact strip for quick visual QA
    strip = Image.new("RGBA", (320 * 4, 320), (245, 240, 225, 255))
    for i, (_, im) in enumerate(frames):
        strip.paste(im, (i * 320, 0), im)
    strip.save(os.path.join(out_dir, f"_preview_{char_id}.png"), "PNG")
    print(f"Processed {char_id} -> 4 poses in {out_dir}")


def process_single(src_path: str, out_path: str):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img = Image.open(src_path).convert("RGB")
    rgba = chroma_key_rgba(img)
    norm = normalize_frame(rgba, target_size=320, pad=14)
    norm.save(out_path, "PNG")
    print(f"Processed single sprite -> {out_path}")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--single":
        process_single(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 4:
        process_sheet(sys.argv[1], sys.argv[2], sys.argv[3])
    else:
        print("Usage: process_doraemon_sprites.py <src_jpg> <out_dir> <char_id>")
        print("   or: process_doraemon_sprites.py --single <src_jpg> <out_png>")
        sys.exit(1)
