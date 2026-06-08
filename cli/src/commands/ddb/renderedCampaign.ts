import { once } from "node:events";

import { pickPageTarget, type CdpTarget } from "./browserAuth.js";
import { extractDdbCampaignRoster, type DdbCampaignRoster } from "./characterImport.js";

type CdpClient = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  close: () => void;
};

export async function scrapeRenderedCampaignRoster(options: {
  port: number;
  campaignId: string;
  sourceUrl: string;
}): Promise<DdbCampaignRoster> {
  const targets = await fetchJson<CdpTarget[]>(`http://127.0.0.1:${options.port}/json/list`);
  const target = pickCampaignTarget(targets, options.campaignId) ?? pickPageTarget(targets);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No Chrome page target found on DevTools port ${options.port}`);
  }

  const client = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: options.sourceUrl });
    const rendered = await waitForRenderedCampaign(client, options.campaignId);
    return extractDdbCampaignRoster({
      campaignId: options.campaignId,
      url: rendered.url,
      title: rendered.title,
      text: rendered.text,
      links: rendered.links,
    });
  } finally {
    client.close();
  }
}

function pickCampaignTarget(targets: CdpTarget[], campaignId: string): CdpTarget | undefined {
  return targets.find((target) => target.type === "page" && target.url.includes(`/campaigns/${campaignId}`));
}

async function waitForRenderedCampaign(client: CdpClient, campaignId: string): Promise<{
  title: string;
  url: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}> {
  const deadline = Date.now() + 30_000;
  let lastState: { title?: string; url?: string; text?: string } | undefined;

  while (Date.now() < deadline) {
    const state = await evaluatePageState(client);
    lastState = state;
    if (
      state.url.includes(`/campaigns/${campaignId}`)
      && /Active Characters|UNASSIGNED CHARACTERS/.test(state.text)
      && state.links.some((link) => /\/characters\/\d+\b/.test(link.href))
    ) {
      return state;
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for rendered D&D Beyond campaign roster${lastState?.title ? ` (${lastState.title})` : ""}`);
}

async function evaluatePageState(client: CdpClient): Promise<{
  title: string;
  url: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}> {
  const result = await evaluate(client, `({
    title: document.title,
    url: location.href,
    text: document.body?.innerText ?? "",
    links: Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      text: (anchor.innerText || anchor.textContent || "").trim().replace(/\\s+/g, " "),
      href: anchor.href,
    })),
  })`);
  return {
    title: typeof result?.title === "string" ? result.title : "",
    url: typeof result?.url === "string" ? result.url : "",
    text: typeof result?.text === "string" ? result.text : "",
    links: Array.isArray(result?.links) ? result.links.filter(isLink) : [],
  };
}

function isLink(value: unknown): value is { text: string; href: string } {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { text?: unknown }).text === "string"
    && typeof (value as { href?: unknown }).href === "string",
  );
}

async function evaluate(client: CdpClient, expression: string): Promise<any> {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return response.result?.value;
}

async function connectCdp(webSocketDebuggerUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data as string);
    if (message.id && pending.has(message.id)) {
      const callbacks = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) callbacks.reject(message.error);
      else callbacks.resolve(message.result);
    }
  };

  await once(socket, "open");

  return {
    send: (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    close: () => socket.close(),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch ${url}: ${reason}`);
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json() as T;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
