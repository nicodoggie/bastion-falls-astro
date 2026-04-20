#!/usr/bin/env python3
"""
Transcribe handwritten scan folders into MDX files using Gemini vision.

Usage:
  python3 astro/migration-scripts/scanned-notes-to-mdx.py \
    --input docs-scans \
    --output astro/src/content/notes/scanned \
    --model gemini-2.5-flash

Env:
  GEMINI_API_KEY=...
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable
from urllib import error, parse, request

from PIL import Image, ImageOps


def natural_sort_key(path: Path) -> list[object]:
    parts = re.split(r"(\d+)", path.name)
    key: list[object] = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part.lower())
    return key


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-+", "-", lowered)
    return lowered.strip("-") or "untitled"


def iter_scan_dirs(root: Path) -> Iterable[Path]:
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if entry.is_dir():
            yield entry


def compress_image(path: Path, max_dim: int, quality: int) -> bytes:
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        return buf.getvalue()


def call_gemini(
    api_key: str,
    model: str,
    image_bytes: bytes,
    mime_type: str,
    filename: str,
    base_url: str,
) -> str:
    prompt = (
        "You are transcribing handwritten fantasy setting notes. "
        "Return a faithful plaintext transcription only. "
        "Preserve line breaks and section headings when clear. "
        "If uncertain, use [illegible]. "
        "Do not summarize or explain. "
        f"Source file: {filename}."
    )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": base64.b64encode(image_bytes).decode("ascii"),
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "topP": 0.95,
            "maxOutputTokens": 4096,
        },
    }

    normalized_base = base_url.rstrip("/")
    encoded_model = parse.quote(model, safe="")
    url = f"{normalized_base}/models/{encoded_model}:generateContent?key={api_key}"

    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini API HTTP {exc.code}: {body}") from exc

    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"No candidates in response: {json.dumps(data)[:1200]}")

    parts = candidates[0].get("content", {}).get("parts", [])
    text_chunks = [part.get("text", "") for part in parts if "text" in part]
    text = "\n".join(chunk.strip("\n") for chunk in text_chunks if chunk.strip())
    if not text:
        raise RuntimeError(
            f"No text returned by model for response: {json.dumps(data)[:1200]}"
        )
    return text.strip()


def build_mdx(title: str, pages: list[tuple[str, str]]) -> str:
    lines: list[str] = [
        "---",
        f"title: {title}",
        "tags:",
        "  - scanned-notes",
        "---",
        "",
    ]

    for filename, text in pages:
        lines.append(f"## Page {filename}")
        lines.append("")
        lines.append(text)
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input", default="docs-scans", help="Input scans root directory"
    )
    parser.add_argument(
        "--output",
        default="astro/src/content/notes/scanned",
        help="Output directory for generated MDX files",
    )
    parser.add_argument("--model", default="gemini-2.5-flash", help="Gemini model id")
    parser.add_argument(
        "--base-url",
        default="https://generativelanguage.googleapis.com/v1beta",
        help="Generative Language API base URL",
    )
    parser.add_argument(
        "--max-dim", type=int, default=1800, help="Max image width/height"
    )
    parser.add_argument("--quality", type=int, default=60, help="JPEG quality 1-95")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compress and enumerate files but skip OCR and writing",
    )
    args = parser.parse_args()

    input_root = Path(args.input).resolve()
    output_root = Path(args.output).resolve()

    if not input_root.exists() or not input_root.is_dir():
        raise SystemExit(f"Input directory not found: {input_root}")

    output_root.mkdir(parents=True, exist_ok=True)

    api_key = os.getenv("GEMINI_API_KEY", "")
    if not args.dry_run and not api_key:
        raise SystemExit("Missing GEMINI_API_KEY environment variable")

    total_pages = 0
    total_docs = 0

    for scan_dir in iter_scan_dirs(input_root):
        image_paths = sorted(
            [
                p
                for p in scan_dir.iterdir()
                if p.is_file()
                and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
            ],
            key=natural_sort_key,
        )
        if not image_paths:
            continue

        title = scan_dir.name
        out_name = f"{slugify(scan_dir.name)}.mdx"
        out_path = output_root / out_name

        print(f"[doc] {title} ({len(image_paths)} pages) -> {out_path}")
        pages: list[tuple[str, str]] = []

        for image_path in image_paths:
            total_pages += 1
            compressed = compress_image(
                image_path, max_dim=args.max_dim, quality=args.quality
            )
            print(
                f"  - {image_path.name}: {image_path.stat().st_size // 1024}KB -> {len(compressed) // 1024}KB"
            )

            if args.dry_run:
                continue

            transcription = call_gemini(
                api_key=api_key,
                model=args.model,
                image_bytes=compressed,
                mime_type="image/jpeg",
                filename=image_path.name,
                base_url=args.base_url,
            )
            pages.append((image_path.name, transcription))

        if args.dry_run:
            continue

        mdx = build_mdx(title=title, pages=pages)
        out_path.write_text(mdx, encoding="utf-8")
        total_docs += 1

    if args.dry_run:
        print(f"Dry run complete. Processed {total_pages} pages.")
    else:
        print(f"Done. Wrote {total_docs} MDX files from {total_pages} pages.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
