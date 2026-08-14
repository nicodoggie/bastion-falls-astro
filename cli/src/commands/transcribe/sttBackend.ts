import { assertResolvedTranscriptionTarget } from "./settings.js";
import type { ResolvedTranscriptionProfile } from "./settings.js";
import { transcribeOpenAiChunk } from "./openAiStt.js";
import { assertTranscriptionPass } from "./passes.js";
import type { TranscriptionPass } from "./passes.js";
import type { ChunkTranscript } from "./types.js";

export type SttBackend = "nodejs-whisper" | "faster-whisper";
export const defaultSttBackend: SttBackend = "nodejs-whisper";

export function parseSttBackend(value: string): SttBackend {
  if (value === "nodejs-whisper" || value === "faster-whisper") return value;
  throw new Error(`Unsupported STT backend: ${value}`);
}

export interface TranscribePassRequest {
  target: ResolvedTranscriptionProfile["target"];
  pass: TranscriptionPass;
  chunks: Array<{ index: number; path: string }>;
  outDir: string;
  language: string;
  prompt?: string;
  force: boolean;
  onProgress?: (message: string) => void;
}

type LocalRunner = (request: TranscribePassRequest) => Promise<ChunkTranscript[]>;

export interface SttBackendDependencies {
  nodejsWhisper?: LocalRunner;
  fasterWhisper?: LocalRunner;
  openAi?: typeof transcribeOpenAiChunk;
}

function validateRequest(request: TranscribePassRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid transcription pass request");
  assertResolvedTranscriptionTarget(request.target);
  assertTranscriptionPass(request.pass);
  if (!Array.isArray(request.chunks) || request.chunks.some((chunk) => !chunk || !Number.isInteger(chunk.index) || chunk.index < 0 || typeof chunk.path !== "string" || !chunk.path.trim())) throw new Error("Invalid transcription chunks");
  if (typeof request.outDir !== "string" || !request.outDir.trim() || typeof request.language !== "string" || typeof request.force !== "boolean") throw new Error("Invalid transcription pass request fields");
  if (request.prompt !== undefined && typeof request.prompt !== "string") throw new Error("Invalid transcription prompt");
  if (request.onProgress !== undefined && typeof request.onProgress !== "function") throw new Error("Invalid transcription progress callback");
}

export async function transcribePass(request: TranscribePassRequest, dependencies: SttBackendDependencies = {}): Promise<ChunkTranscript[]> {
  validateRequest(request);
  switch (request.target.provider) {
    case "openai-compatible": {
      const adapter = dependencies.openAi ?? transcribeOpenAiChunk;
      const target = request.target as Extract<ResolvedTranscriptionProfile["target"], { provider: "openai-compatible" }>;
      return Promise.all(request.chunks.map((chunk) => adapter({
        target,
        pass: request.pass,
        chunk,
        language: request.language,
        prompt: request.prompt,
        onProgress: request.onProgress,
      })));
    }
    case "nodejs-whisper":
      if (!dependencies.nodejsWhisper) throw new Error("nodejs-whisper dispatch requires an injected local runner");
      return dependencies.nodejsWhisper(request);
    case "faster-whisper":
      if (!dependencies.fasterWhisper) throw new Error("faster-whisper dispatch requires an injected local runner");
      return dependencies.fasterWhisper(request);
  }
}
