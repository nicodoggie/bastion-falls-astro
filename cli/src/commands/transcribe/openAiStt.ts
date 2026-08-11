import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";

import { assertResolvedTranscriptionTarget } from "./settings.js";
import type { ResolvedTranscriptionProfile } from "./settings.js";
import { assertTranscriptionPass } from "./passes.js";
import type { TranscriptionPass } from "./passes.js";
import type { ChunkTranscript, TranscriptSegment } from "./types.js";

type OpenAiTarget = Extract<ResolvedTranscriptionProfile["target"], { provider: "openai-compatible" }>;

export interface OpenAiSttRequest {
  target: OpenAiTarget;
  pass: TranscriptionPass;
  chunk: { index: number; path: string };
  language: string;
  prompt?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

const segmentSchema = z.object({
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(),
  text: z.string(),
  avg_logprob: z.number().finite().optional(),
  compression_ratio: z.number().finite().optional(),
  no_speech_prob: z.number().finite().optional(),
  temperature: z.number().finite().optional(),
  confidence: z.number().finite().optional(),
}).passthrough();

const responseSchema = z.object({
  // A required, empty array is the valid representation of a silent chunk.
  segments: z.array(segmentSchema),
  language: z.string().optional(),
  language_probability: z.number().finite().optional(),
  duration: z.number().finite().nonnegative().optional(),
}).passthrough();

function validateRequest(request: OpenAiSttRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid OpenAI-compatible STT request");
  const target = request.target;
  assertResolvedTranscriptionTarget(target);
  if (target.provider !== "openai-compatible") {
    throw new Error("Invalid OpenAI-compatible STT target");
  }
  try {
    const url = new URL(target.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  } catch { throw new Error(`Invalid OpenAI-compatible STT target ${target.name}: baseUrl must use http or https`); }
  assertTranscriptionPass(request.pass);
  if (request.chunk === null || typeof request.chunk !== "object" || Array.isArray(request.chunk) ||
      !Number.isInteger(request.chunk.index) || request.chunk.index < 0 || typeof request.chunk.path !== "string" || !request.chunk.path.trim()) {
    throw new Error("Invalid transcription chunk");
  }
  if (typeof request.language !== "string" || (request.prompt !== undefined && typeof request.prompt !== "string")) {
    throw new Error(`Invalid language or prompt for target ${target.name}`);
  }
}

function endpointFor(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/audio/transcriptions`;
}

function targetChunkLabel(request: OpenAiSttRequest): string {
  return `target ${request.target.name}, chunk ${request.chunk.index} (${basename(request.chunk.path)})`;
}

function envValue(request: OpenAiSttRequest): string | undefined {
  const name = request.target.apiKeyEnv;
  if (!name) return undefined;
  const value = (request.env ?? process.env)[name];
  if (!value?.trim()) throw new Error(`${targetChunkLabel(request)} is missing configured API key environment variable ${name}`);
  return value;
}

function formFor(request: OpenAiSttRequest, audio: Buffer): FormData {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/flac" }), basename(request.chunk.path));
  form.append("model", request.target.model);
  form.append("response_format", "verbose_json");
  if (request.language.trim()) form.append("language", request.language.trim());
  if (request.prompt?.trim()) form.append("prompt", request.prompt.trim());
  return form;
}

function normalize(value: z.infer<typeof responseSchema>, request: OpenAiSttRequest): ChunkTranscript {
  const segments: TranscriptSegment[] = value.segments.map((segment) => {
    if (segment.end < segment.start) throw new Error("segment end precedes start");
    return {
      start: segment.start,
      end: segment.end,
      text: segment.text,
      ...(segment.confidence === undefined ? {} : { confidence: segment.confidence }),
      ...(segment.avg_logprob === undefined ? {} : { avgLogprob: segment.avg_logprob }),
      ...(segment.compression_ratio === undefined ? {} : { compressionRatio: segment.compression_ratio }),
      ...(segment.no_speech_prob === undefined ? {} : { noSpeechProb: segment.no_speech_prob }),
      ...(segment.temperature === undefined ? {} : { temperature: segment.temperature }),
    };
  });
  return {
    segments,
    ...(value.language === undefined ? {} : { language: value.language }),
    ...(value.language_probability === undefined ? {} : { language_probability: value.language_probability }),
    ...(value.duration === undefined ? {} : { duration: value.duration }),
  };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export async function transcribeOpenAiChunk(request: OpenAiSttRequest): Promise<ChunkTranscript> {
  validateRequest(request);
  const label = targetChunkLabel(request);
  const endpoint = endpointFor(request.target.baseUrl);
  let audio: Buffer;
  try {
    audio = await readFile(request.chunk.path);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "read failure";
    throw new Error(`${label} audio file could not be read (${code})`);
  }
  const fetchImpl = request.fetchImpl ?? fetch;
  const sleep = request.sleep ?? (async (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const totalAttempts = request.target.retries + 1;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const apiKey = envValue(request);
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: formFor(request, audio),
        signal: AbortSignal.timeout(request.target.timeoutSeconds * 1000),
      });
      if (!response.ok) {
        const error = new Error(`${label} request failed with HTTP ${response.status} after ${attempt}/${totalAttempts} attempts`);
        if (!retryableStatus(response.status) || attempt === totalAttempts) throw error;
        lastError = error;
      } else {
        let body: unknown;
        try { body = await response.json(); } catch { throw new Error(`${label} received incompatible response (invalid JSON)`); }
        const parsed = responseSchema.safeParse(body);
        if (!parsed.success) throw new Error(`${label} received incompatible response (missing or malformed verbose segments)`);
        try { return normalize(parsed.data, request); } catch { throw new Error(`${label} received incompatible response (invalid segment timing)`); }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failure";
      const isHttpRetry = /^.*request failed with HTTP (408|429|5\d\d)/.test(message);
      const isTimeout = error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
      const retryable = isHttpRetry || error instanceof TypeError || isTimeout;
      if (!retryable || attempt === totalAttempts) {
        if (error instanceof Error && error.message.startsWith(label)) throw error;
        throw new Error(`${label} request failed (${isTimeout ? "timeout" : "network failure"}) at ${endpoint} after attempt ${attempt}/${totalAttempts}`);
      }
      lastError = error instanceof Error ? error : new Error("request failure");
    }
    await sleep(Math.min(2000, 250 * 2 ** (attempt - 1)));
  }
  throw lastError ?? new Error(`${label} request failed after ${totalAttempts} attempts`);
}
