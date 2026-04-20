#!/usr/bin/env python3
"""
Resize/compress scanned images for manual multimodal transcription.

Usage:
  python3 astro/migration-scripts/resize-scans.py \
    --input docs-scans \
    --output docs-scans-compressed \
    --max-dim 1800 \
    --quality 60
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageOps


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def natural_sort_key(path: Path) -> list[object]:
    parts = re.split(r"(\d+)", path.name)
    key: list[object] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part.lower())
    return key


def iter_scan_dirs(root: Path):
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if entry.is_dir():
            yield entry


def compress_image(src: Path, dst: Path, max_dim: int, quality: int) -> tuple[int, int]:
    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst, format="JPEG", quality=quality, optimize=True, progressive=True)
    return src.stat().st_size, dst.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="docs-scans", help="Input scans root")
    parser.add_argument("--output", default="docs-scans-compressed", help="Output root")
    parser.add_argument("--max-dim", type=int, default=1800, help="Max width/height")
    parser.add_argument("--quality", type=int, default=60, help="JPEG quality 1-95")
    parser.add_argument(
        "--overwrite", action="store_true", help="Overwrite output files"
    )
    args = parser.parse_args()

    src_root = Path(args.input).resolve()
    out_root = Path(args.output).resolve()

    if not src_root.exists() or not src_root.is_dir():
        raise SystemExit(f"Input directory not found: {src_root}")

    out_root.mkdir(parents=True, exist_ok=True)

    total_pages = 0
    total_in_bytes = 0
    total_out_bytes = 0

    for scan_dir in iter_scan_dirs(src_root):
        image_paths = sorted(
            [
                p
                for p in scan_dir.iterdir()
                if p.is_file() and p.suffix.lower() in IMAGE_EXTS
            ],
            key=natural_sort_key,
        )
        if not image_paths:
            continue

        rel_dir = scan_dir.relative_to(src_root)
        print(f"[doc] {rel_dir} ({len(image_paths)} pages)")

        for src in image_paths:
            total_pages += 1
            dst = out_root / rel_dir / f"{src.stem}.jpg"

            if dst.exists() and not args.overwrite:
                in_size = src.stat().st_size
                out_size = dst.stat().st_size
                print(
                    f"  - {src.name}: skip existing ({in_size // 1024}KB -> {out_size // 1024}KB)"
                )
            else:
                in_size, out_size = compress_image(
                    src, dst, max_dim=args.max_dim, quality=args.quality
                )
                print(f"  - {src.name}: {in_size // 1024}KB -> {out_size // 1024}KB")

            total_in_bytes += in_size
            total_out_bytes += out_size

    saved = total_in_bytes - total_out_bytes
    saved_pct = (saved / total_in_bytes * 100) if total_in_bytes else 0.0

    print()
    print(f"Processed pages: {total_pages}")
    print(f"Input size:  {total_in_bytes / (1024 * 1024):.2f} MB")
    print(f"Output size: {total_out_bytes / (1024 * 1024):.2f} MB")
    print(f"Saved:       {saved / (1024 * 1024):.2f} MB ({saved_pct:.1f}%)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
