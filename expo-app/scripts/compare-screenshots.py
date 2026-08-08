#!/usr/bin/env python3
"""Create deterministic 95%-fidelity evidence for a native/Expo screenshot pair."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("native", type=Path)
    parser.add_argument("expo", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--tolerance",
        type=int,
        default=3,
        help="Maximum per-channel pixel error counted as visually equivalent (default: 3).",
    )
    parser.add_argument(
        "--minimum-ratio",
        type=float,
        default=0.95,
        help="Minimum visually equivalent pixel ratio required for PASS (default: 0.95).",
    )
    args = parser.parse_args()
    if not 0 <= args.tolerance <= 255:
        parser.error("--tolerance must be between 0 and 255")
    if not 0.95 <= args.minimum_ratio <= 1:
        parser.error("--minimum-ratio must be between 0.95 and 1")
    return args


def main() -> None:
    args = parse_args()
    native = Image.open(args.native).convert("RGB")
    expo = Image.open(args.expo).convert("RGB")
    if native.size != expo.size:
        raise SystemExit(f"Screenshot dimensions differ: native={native.size}, expo={expo.size}")

    native_pixels = np.asarray(native, dtype=np.int16)
    expo_pixels = np.asarray(expo, dtype=np.int16)
    channel_diff = np.abs(native_pixels - expo_pixels)
    pixel_diff = np.max(channel_diff, axis=2)
    exact_ratio = float(np.mean(pixel_diff == 0))
    different_pixels = int(np.count_nonzero(pixel_diff))
    visual_ratio = float(np.mean(pixel_diff <= args.tolerance))
    passed = visual_ratio >= args.minimum_ratio

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(channel_diff * 8, 0, 255).astype(np.uint8), "RGB").save(
        output / "diff-8x.png"
    )

    metrics = {
        "width": native.width,
        "height": native.height,
        "exact_ratio": exact_ratio,
        "within_1_ratio": float(np.mean(pixel_diff <= 1)),
        "within_3_ratio": float(np.mean(pixel_diff <= 3)),
        "within_8_ratio": float(np.mean(pixel_diff <= 8)),
        "visual_tolerance": args.tolerance,
        "minimum_visual_ratio": args.minimum_ratio,
        "visual_ratio": visual_ratio,
        "rgb_mae": float(np.mean(channel_diff)),
        "rgb_rmse": float(np.sqrt(np.mean(np.square(channel_diff.astype(np.float64))))),
        "max_channel_error": int(np.max(channel_diff)),
        "different_pixels": different_pixels,
        "verdict": "PASS" if passed else "FAIL",
        "reason": (
            f"{visual_ratio:.4%} of pixels are within ±{args.tolerance}; "
            f"the visual threshold is {args.minimum_ratio:.2%}. "
            "Functional and backend parity require separate 1:1 verification."
        ),
    }
    with (output / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
