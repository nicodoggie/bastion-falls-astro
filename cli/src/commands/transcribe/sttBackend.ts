export type SttBackend = "nodejs-whisper" | "faster-whisper";

export const defaultSttBackend: SttBackend = "nodejs-whisper";

export function parseSttBackend(value: string): SttBackend {
  if (value === "nodejs-whisper" || value === "faster-whisper") {
    return value;
  }
  throw new Error(`Unsupported STT backend: ${value}`);
}

