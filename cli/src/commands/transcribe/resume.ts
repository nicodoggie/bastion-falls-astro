import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Manifest } from "./types.js";

export function chunkPathForIndex(chunksDir: string, index: number): string {
  return join(chunksDir, `session_${String(index).padStart(3, "0")}.flac`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readManifest(path: string): Promise<Manifest | undefined> {
  if (!(await exists(path))) {
    return undefined;
  }
  return JSON.parse(await readFile(path, "utf8")) as Manifest;
}

export async function canReuseAudioChunks(options: {
  manifest: Manifest;
  chunksDir: string;
}): Promise<{ reusable: boolean; chunkPaths: string[]; missingIndexes: number[] }> {
  const chunkPaths = options.manifest.chunks.map((chunk) => chunkPathForIndex(options.chunksDir, chunk.index));
  const missingIndexes: number[] = [];

  await Promise.all(
    chunkPaths.map(async (chunkPath, index) => {
      if (!(await exists(chunkPath))) {
        const chunk = options.manifest.chunks[index];
        missingIndexes.push(chunk?.index ?? index);
      }
    }),
  );
  missingIndexes.sort((a, b) => a - b);

  return {
    reusable: missingIndexes.length === 0,
    chunkPaths,
    missingIndexes,
  };
}

