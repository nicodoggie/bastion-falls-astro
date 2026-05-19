import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { runCommand } from "./process.js";

export interface LocalWhisperOptions {
  chunkPaths: string[];
  outDir: string;
  model: string;
  device: string;
  computeType: string;
  python: string;
  force: boolean;
}

const prompt = [
  "This is a tabletop Dungeons and Dragons game recording with mixed English and Tagalog/Filipino.",
  "Preserve the original language; do not translate Tagalog into English.",
  "Keep D&D terms, character names, place names, dice rolls, and rules discussion as accurately as possible.",
].join(" ");

const pythonScript = String.raw`
from __future__ import annotations

import argparse
import json
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chunks-json", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--compute-type", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    chunk_paths = [Path(path) for path in json.loads(args.chunks_json)]
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    for chunk_path in chunk_paths:
        json_path = out_dir / f"{chunk_path.stem}.json"
        if json_path.exists() and json_path.stat().st_size > 0 and not args.force:
            print(f"skip {chunk_path.stem}", flush=True)
            continue

        print(f"transcribe {chunk_path.stem}", flush=True)
        segments, info = model.transcribe(
            str(chunk_path),
            beam_size=5,
            vad_filter=True,
            initial_prompt=args.prompt,
            condition_on_previous_text=False,
        )

        rows = []
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            rows.append({
                "start": segment.start,
                "end": segment.end,
                "text": text,
                "avgLogprob": segment.avg_logprob,
                "compressionRatio": segment.compression_ratio,
                "noSpeechProb": segment.no_speech_prob,
                "temperature": segment.temperature,
            })

        json_path.write_text(
            json.dumps(
                {
                    "chunk": chunk_path.name,
                    "language": info.language,
                    "language_probability": info.language_probability,
                    "duration": info.duration,
                    "segments": rows,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

export async function transcribeChunksWithLocalWhisper(options: LocalWhisperOptions): Promise<string[]> {
  await mkdir(options.outDir, { recursive: true });
  await runCommand(options.python, [
    "-c",
    pythonScript,
    "--chunks-json",
    JSON.stringify(options.chunkPaths),
    "--out-dir",
    options.outDir,
    "--model",
    options.model,
    "--device",
    options.device,
    "--compute-type",
    options.computeType,
    "--prompt",
    prompt,
    ...(options.force ? ["--force"] : []),
  ]);

  return options.chunkPaths.map((chunkPath) => join(options.outDir, `${basename(chunkPath, ".flac")}.json`));
}
