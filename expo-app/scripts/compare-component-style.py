#!/usr/bin/env python3
"""Compare cross-framework component style without pretending to be pixel-identical.

The Expo port targets 95–98% component-style fidelity, while native SwiftUI and
React Native rasterize fonts, SF Symbols, shadows and bundled bitmaps differently.
This report therefore preserves strict pixel metrics and separately computes a
4-point blurred structural SSIM plus normalized mean RGB similarity.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("native", type=Path)
    parser.add_argument("expo", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scale", type=float, default=3.0, help="Screenshot pixels per layout point.")
    parser.add_argument("--blur-points", type=float, default=4.0)
    parser.add_argument("--minimum-ratio", type=float, default=0.95)
    parser.add_argument(
        "--crop",
        type=int,
        nargs=4,
        metavar=("X", "Y", "WIDTH", "HEIGHT"),
        help="Compare a fixed component crop instead of allowing the full-screen background to dominate.",
    )
    args = parser.parse_args()
    if args.scale <= 0 or args.blur_points < 0:
        parser.error("--scale must be positive and --blur-points cannot be negative")
    if not 0.95 <= args.minimum_ratio <= 1:
        parser.error("--minimum-ratio must be between 0.95 and 1")
    return args


def global_ssim(left: np.ndarray, right: np.ndarray) -> float:
    left_mean = float(left.mean())
    right_mean = float(right.mean())
    left_variance = float(left.var())
    right_variance = float(right.var())
    covariance = float(np.mean((left - left_mean) * (right - right_mean)))
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    luminance = (2 * left_mean * right_mean + c1) / (
        left_mean**2 + right_mean**2 + c1
    )
    structure = (2 * covariance + c2) / (left_variance + right_variance + c2)
    return luminance * structure


def main() -> None:
    args = parse_args()
    native = Image.open(args.native).convert("RGB")
    expo = Image.open(args.expo).convert("RGB")
    if native.size != expo.size:
        raise SystemExit(f"Screenshot dimensions differ: native={native.size}, expo={expo.size}")

    input_width, input_height = native.size
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    crop_metrics = None
    if args.crop:
        x, y, width, height = args.crop
        if x < 0 or y < 0 or width <= 0 or height <= 0:
            raise SystemExit("--crop requires non-negative X/Y and positive WIDTH/HEIGHT")
        if x + width > input_width or y + height > input_height:
            raise SystemExit(
                f"Crop exceeds screenshot bounds: crop={args.crop}, size={native.size}"
            )
        box = (x, y, x + width, y + height)
        native = native.crop(box)
        expo = expo.crop(box)
        native.save(output / "native-crop.png")
        expo.save(output / "expo-crop.png")
        crop_metrics = {"x": x, "y": y, "width": width, "height": height}

    native_pixels = np.asarray(native, dtype=np.float64)
    expo_pixels = np.asarray(expo, dtype=np.float64)
    channel_diff = np.abs(native_pixels - expo_pixels)
    pixel_diff = np.max(channel_diff, axis=2)
    rgb_mae = float(np.mean(channel_diff))
    normalized_rgb_similarity = 1 - rgb_mae / 255

    blur_radius = args.blur_points * args.scale
    native_structure = np.asarray(
        native.convert("L").filter(ImageFilter.GaussianBlur(blur_radius)), dtype=np.float64
    )
    expo_structure = np.asarray(
        expo.convert("L").filter(ImageFilter.GaussianBlur(blur_radius)), dtype=np.float64
    )
    structure_similarity = global_ssim(native_structure, expo_structure)
    style_similarity = min(normalized_rgb_similarity, structure_similarity)
    passed = style_similarity >= args.minimum_ratio

    Image.fromarray(np.clip(channel_diff * 8, 0, 255).astype(np.uint8), "RGB").save(
        output / "diff-8x.png"
    )
    metrics = {
        "contract": "component-style-95-98-not-pixel-exact",
        "input_width": input_width,
        "input_height": input_height,
        "crop": crop_metrics,
        "width": native.width,
        "height": native.height,
        "minimum_style_ratio": args.minimum_ratio,
        "style_similarity": style_similarity,
        "normalized_rgb_similarity": normalized_rgb_similarity,
        "component_structure_ssim": structure_similarity,
        "structure_blur_points": args.blur_points,
        "structure_blur_pixels": blur_radius,
        "strict_pixel_within_3_ratio": float(np.mean(pixel_diff <= 3)),
        "strict_pixel_within_8_ratio": float(np.mean(pixel_diff <= 8)),
        "rgb_mae": rgb_mae,
        "rgb_rmse": float(np.sqrt(np.mean(np.square(channel_diff)))),
        "verdict": "PASS" if passed else "FAIL",
        "reason": (
            f"Component-style similarity is {style_similarity:.4%} "
            f"(normalized RGB {normalized_rgb_similarity:.4%}, "
            f"4pt structural SSIM {structure_similarity:.4%}); "
            f"threshold is {args.minimum_ratio:.2%}. Strict pixel ratios are retained for audit."
        ),
    }
    with (output / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
