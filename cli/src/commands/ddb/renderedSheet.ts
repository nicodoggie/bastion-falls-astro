import { once } from "node:events";

import { parseRenderedCharacterText, type RenderedCharacterData, type RenderedCharacterTab } from "./characterImport.js";
import { pickPageTarget, type CdpTarget } from "./browserAuth.js";

type CdpClient = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  close: () => void;
};

export async function scrapeRenderedCharacterSheet(options: {
  port: number;
  characterId: string;
  sourceUrl: string;
}): Promise<RenderedCharacterData> {
  const targets = await fetchJson<CdpTarget[]>(`http://127.0.0.1:${options.port}/json/list`);
  const target = pickCharacterTarget(targets, options.characterId) ?? pickPageTarget(targets);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No Chrome page target found on DevTools port ${options.port}`);
  }

  const client = await connectCdp(target.webSocketDebuggerUrl);
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: `https://www.dndbeyond.com/characters/${options.characterId}` });

    const sheet = await waitForRenderedSheet(client, options.characterId);
    const tabs: Record<string, RenderedCharacterTab> = {
      background: await clickTabAndRead(client, "BACKGROUND"),
      notes: await clickTabAndRead(client, "NOTES"),
      features: await clickTabAndRead(client, "FEATURES & TRAITS"),
    };

    const rendered = parseRenderedCharacterText({
      characterId: options.characterId,
      url: sheet.url,
      title: sheet.title,
      text: sheet.text,
    });

    return { ...rendered, tabs };
  } finally {
    client.close();
  }
}

function pickCharacterTarget(targets: CdpTarget[], characterId: string): CdpTarget | undefined {
  return targets.find((target) => target.type === "page" && target.url.includes(`/characters/${characterId}`));
}

async function waitForRenderedSheet(client: CdpClient, characterId: string): Promise<{ title: string; url: string; text: string }> {
  const deadline = Date.now() + 30_000;
  let lastState: { title?: string; url?: string; text?: string; ready?: string } | undefined;

  while (Date.now() < deadline) {
    lastState = await evaluatePageState(client);
    const text = lastState.text ?? "";
    if (
      lastState.url?.includes(`/characters/${characterId}`)
      && /Ability Scores/.test(text)
      && /HIT POINTS/.test(text)
      && /ARMOR CLASS/.test(text)
    ) {
      return {
        title: lastState.title ?? "",
        url: lastState.url,
        text,
      };
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for rendered D&D Beyond character sheet${lastState?.title ? ` (${lastState.title})` : ""}`);
}

async function clickTabAndRead(client: CdpClient, label: string): Promise<RenderedCharacterTab> {
  const escapedLabel = JSON.stringify(label);
  const expression = `
    (async () => {
      const label = ${escapedLabel};
      const elements = [...document.querySelectorAll("button,a,div,span,[role='tab']")];
      const target = elements.find((element) => (element.innerText || element.textContent || "").trim() === label)
        || elements.find((element) => (element.innerText || element.textContent || "").includes(label));
      if (target instanceof HTMLElement) {
        target.click();
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      return { clicked: !!target, text: document.body?.innerText ?? "" };
    })()
  `;
  const result = await evaluate(client, expression);
  return {
    clicked: Boolean(result?.clicked),
    text: typeof result?.text === "string" ? result.text : "",
  };
}

async function evaluatePageState(client: CdpClient): Promise<{ title: string; url: string; text: string; ready: string }> {
  const result = await evaluate(client, `({
    title: document.title,
    url: location.href,
    text: document.body?.innerText ?? "",
    ready: document.readyState,
  })`);
  return {
    title: typeof result?.title === "string" ? result.title : "",
    url: typeof result?.url === "string" ? result.url : "",
    text: typeof result?.text === "string" ? result.text : "",
    ready: typeof result?.ready === "string" ? result.ready : "",
  };
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
