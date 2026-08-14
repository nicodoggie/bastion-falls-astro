import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { Agent } from "undici";

import type { OpenAiTranscriptionTarget } from "./settings.js";
import { cleanupOpenAiChunk, transcribeOpenAiChunk } from "./openAiStt.js";

const pass = { kind: "stereo" as const, id: "stereo" as const };

async function withServer(handler: (request: Request) => Response | Promise<Response>, run: (baseUrl: string, requests: () => number) => Promise<void>) {
  let count = 0;
  const server = createServer(async (req, res) => {
    count += 1;
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
    const response = await handler(new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    }));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}/v1`, () => count);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function target(baseUrl: string, overrides: Partial<OpenAiTranscriptionTarget> = {}): OpenAiTranscriptionTarget & { name: string } {
  return { name: "remote-test", provider: "openai-compatible", protocol: "openai", baseUrl, model: "whisper-remote", timeoutSeconds: 5, retries: 0, ...overrides };
}

test("posts a real multipart request and normalizes verbose timed segments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openai-stt-"));
  const audioPath = join(directory, "chunk.flac");
  const audio = Buffer.from("real-audio-bytes");
  await writeFile(audioPath, audio);
  let statusReads = 0;
  let idempotencyKey: string | null = null;
  await withServer(async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "POST") {
      assert.equal(path, "/v1/transcription-jobs");
      assert.equal(request.headers.get("authorization"), "Bearer test-secret");
      idempotencyKey = request.headers.get("x-idempotency-key");
      assert.match(idempotencyKey ?? "", /^[0-9a-f]{64}$/);
      const form = await request.formData();
      const file = form.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.name, basename(audioPath));
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
      assert.equal(form.get("model"), "whisper-remote");
      assert.equal(form.get("response_format"), "verbose_json");
      assert.equal(form.get("language"), "en");
      assert.equal(form.get("prompt"), "names");
      return Response.json({ id: "a".repeat(32), status: "queued", created: true }, { status: 202 });
    }
    if (request.method === "GET" && path.endsWith("/result")) {
      return Response.json({
        language: "en",
        duration: 2,
        segments: [
          { start: 0, end: 1.25, text: " hello ", avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01 },
          { start: 1.25, end: 2, text: "world", temperature: 0.1 },
        ],
      });
    }
    if (request.method === "GET") {
      statusReads += 1;
      return Response.json({ id: "a".repeat(32), status: statusReads === 1 ? "running" : "succeeded" });
    }
    assert.equal(request.method, "DELETE");
    return new Response(null, { status: 204 });
  }, async (baseUrl, requests) => {
    const transcript = await transcribeOpenAiChunk({
      target: target(baseUrl, { apiKeyEnv: "OPENAI_STT_TEST_KEY", protocol: "bastion-jobs" }),
      pass,
      chunk: { index: 2, path: audioPath },
      language: " en ",
      prompt: " names ",
      env: { OPENAI_STT_TEST_KEY: "test-secret" },
      sleep: async () => undefined,
    });
    assert.deepEqual(transcript, {
      language: "en",
      duration: 2,
      segments: [
        { start: 0, end: 1.25, text: " hello ", avgLogprob: -0.2, compressionRatio: 1.1, noSpeechProb: 0.01 },
        { start: 1.25, end: 2, text: "world", temperature: 0.1 },
      ],
    });
    assert.ok(idempotencyKey);
    assert.equal(requests(), 4);
    await cleanupOpenAiChunk(transcript);
    assert.equal(requests(), 5);
  });
});

test("configures and closes an owned dispatcher at the target timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openai-stt-"));
  const audioPath = join(directory, "chunk.flac");
  await writeFile(audioPath, "audio");
  let configuredTimeout: number | undefined;
  let closed = 0;

  await withServer(async () => Response.json({ segments: [] }), async (baseUrl) => {
    await transcribeOpenAiChunk({
      target: target(baseUrl, { timeoutSeconds: 900 }),
      pass,
      chunk: { index: 0, path: audioPath },
      language: "en",
      dispatcherFactory: (timeoutMilliseconds) => {
        configuredTimeout = timeoutMilliseconds;
        const dispatcher = new Agent();
        return {
          dispatcher,
          close: async () => {
            closed += 1;
            await dispatcher.close();
          },
        };
      },
    });
  });

  assert.equal(configuredTimeout, 900_000);
  assert.equal(closed, 1);
});

test("reuses the idempotency key when the submission response is lost", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openai-stt-lost-response-"));
  const audioPath = join(directory, "chunk.flac");
  await writeFile(audioPath, "audio");
  const submissionKeys: string[] = [];
  let call = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    call += 1;
    if (init?.method === "POST") {
      submissionKeys.push(new Headers(init.headers).get("x-idempotency-key") ?? "");
      if (submissionKeys.length === 1) throw new TypeError("connection lost after acceptance");
      return Response.json({ id: "b".repeat(32), status: "running" }, { status: 202 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (String(_input).endsWith("/result")) return Response.json({ segments: [] });
    return Response.json({ id: "b".repeat(32), status: "succeeded" });
  };

  const transcript = await transcribeOpenAiChunk({
    target: target("https://example.test/v1", { protocol: "bastion-jobs", retries: 1 }),
    pass,
    chunk: { index: 3, path: audioPath },
    language: "en",
    fetchImpl,
    sleep: async () => undefined,
  });
  assert.deepEqual(submissionKeys, [submissionKeys[0], submissionKeys[0]]);
  assert.match(submissionKeys[0] ?? "", /^[0-9a-f]{64}$/);
  assert.equal(call, 4);
  await cleanupOpenAiChunk(transcript);
  assert.equal(call, 5);
});

test("retries only transient failures and performs zero I/O for a missing key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openai-stt-"));
  const audioPath = join(directory, "chunk.flac");
  await writeFile(audioPath, "audio");
  let failureRequests = 0;
  await withServer(async () => {
    const attempt = failureRequests;
    failureRequests += 1;
    if (attempt < 3) return new Response("secret body", { status: 503 });
    if (attempt === 3) return new Response("private 400 body", { status: 400 });
    return Response.json({ text: "text-only must be rejected" });
  }, async (baseUrl, requests) => {
    await assert.rejects(
      transcribeOpenAiChunk({ target: target(baseUrl, { retries: 2 }), pass, chunk: { index: 0, path: audioPath }, language: "en", sleep: async () => undefined }),
      (error: Error) => error.message.includes("3 attempts") && !error.message.includes("secret body"),
    );
    assert.equal(requests(), 3);
    await assert.rejects(
      transcribeOpenAiChunk({ target: target(baseUrl, { retries: 2 }), pass, chunk: { index: 0, path: audioPath }, language: "en", sleep: async () => undefined }),
      (error: Error) => error.message.includes("HTTP 400") && error.message.includes("1/3 attempts") && !error.message.includes("private 400 body"),
    );
    assert.equal(requests(), 4);
    await assert.rejects(
      transcribeOpenAiChunk({ target: target(baseUrl, { retries: 2 }), pass, chunk: { index: 0, path: audioPath }, language: "en", sleep: async () => undefined }),
      (error: Error) => error.message.includes("incompatible response") && !error.message.includes("text-only"),
    );
    assert.equal(requests(), 5);
    await assert.rejects(
      transcribeOpenAiChunk({ target: target(baseUrl, { apiKeyEnv: "MISSING_STT_KEY" }), pass, chunk: { index: 0, path: audioPath }, language: "en", env: {} }),
      (error: Error) => error.message.includes("remote-test") && error.message.includes("MISSING_STT_KEY") && !error.message.includes("secret"),
    );
    assert.equal(requests(), 5);
    let timeoutAttempts = 0;
    await assert.rejects(
      transcribeOpenAiChunk({
        target: target(baseUrl, { retries: 2 }),
        pass,
        chunk: { index: 0, path: audioPath },
        language: "en",
        sleep: async () => undefined,
        fetchImpl: async () => {
          timeoutAttempts += 1;
          throw new DOMException("secret timeout body", "TimeoutError");
        },
      }),
      (error: Error) => error.message.includes("timeout") && error.message.includes("/v1/audio/transcriptions") &&
        error.message.includes("attempt 3/3") && !error.message.includes("secret"),
    );
    assert.equal(timeoutAttempts, 3);
    let invalidUrlRequests = 0;
    await assert.rejects(
      transcribeOpenAiChunk({
        target: target("ftp://127.0.0.1/v1"),
        pass,
        chunk: { index: 0, path: audioPath },
        language: "en",
        fetchImpl: async () => { invalidUrlRequests += 1; return new Response(); },
      }),
      /baseUrl must use http or https/i,
    );
    assert.equal(invalidUrlRequests, 0);
    await assert.rejects(
      transcribeOpenAiChunk({
        target: { ...target(baseUrl), apiKeyEnv: 42 } as never,
        pass,
        chunk: { index: 0, path: audioPath },
        language: "en",
        fetchImpl: async () => { invalidUrlRequests += 1; return new Response(); },
      }),
      /Invalid resolved transcription target: apiKeyEnv/,
    );
    assert.equal(invalidUrlRequests, 0);
    let non5xxAttempts = 0;
    await assert.rejects(
      transcribeOpenAiChunk({
        target: target(baseUrl, { retries: 2 }),
        pass,
        chunk: { index: 0, path: audioPath },
        language: "en",
        fetchImpl: async () => {
          non5xxAttempts += 1;
          return { ok: false, status: 600 } as Response;
        },
      }),
      /HTTP 600.*1\/3 attempts/,
    );
    assert.equal(non5xxAttempts, 1);
  });
});
