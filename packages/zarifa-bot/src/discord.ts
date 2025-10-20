import crypto from "node:crypto";

export type DiscordInteraction = {
  type: number;
  data?: any;
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export async function verifyDiscordRequest(
  request: Request,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    if (!signature || !timestamp) return false;

    const body = await request.clone().text();
    const isValid = await ed25519Verify(
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
      hexToBytes(publicKeyHex)
    );
    return isValid;
  } catch (_err) {
    return false;
  }
}

async function ed25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    publicKey as BufferSource,
    { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as any,
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    { name: 'NODE-ED25519' } as any,
    key,
    signature as BufferSource,
    message as BufferSource
  );
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function formatResults(results: any): string {
  try {
    // Cloudflare AI Search returns data in the "data" array
    const hits = results?.data || [];
    if (!hits.length) return 'No results.';

    // Format top 3 results with title and URL
    const top = hits.slice(0, 3)
      .map((h: any, i: number) => {
        const title = h.attributes?.file?.title ?? h.filename ?? 'result';
        const url = h.filename ?? '';
        const score = h.score ? ` (${(h.score * 100).toFixed(0)}%)` : '';
        return `**${i + 1}. ${title}**${score}\n${url}`;
      })
      .join('\n\n');

    // If there's an AI-generated response, include it
    if (results?.response) {
      return `${results.response.slice(0, 500)}${results.response.length > 500 ? '...' : ''}\n\n**Sources:**\n${top}`;
    }

    return top;
  } catch (_e) {
    console.error('Error formatting results:', _e);
    return 'No results.';
  }
}


