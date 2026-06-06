import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CdpCookie = {
  name: string;
  value: string;
  domain?: string;
};

export type CdpTarget = {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export type ChromeSession = {
  port: number;
  profileDir: string;
  process?: ChildProcess;
};

export function buildCookieHeader(cookies: CdpCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`).join("; ");
}

export function pickPageTarget(targets: CdpTarget[]): CdpTarget | undefined {
  return targets.find((target) => target.type === "page" && /\/characters\/\d+/.test(target.url))
    ?? targets.find((target) => target.type === "page" && /dndbeyond\.com/.test(target.url))
    ?? targets.find((target) => target.type === "page");
}

export async function launchChromeForDdbAuth(options: {
  chromePath?: string;
  port: number;
  profileDir?: string;
  loginUrl?: string;
}): Promise<ChromeSession> {
  const profileDir = options.profileDir ?? join(tmpdir(), `bfcli-ddb-auth-${options.port}`);
  await mkdir(profileDir, { recursive: true });

  const chromePath = options.chromePath ?? process.env.DDB_CHROME_PATH ?? defaultChromePath();
  const child = spawn(chromePath, [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--new-window",
    options.loginUrl ?? "https://www.dndbeyond.com/login",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  await waitForDevtools(options.port);
  return { port: options.port, profileDir, process: child };
}

export async function getDdbCookieHeader(port: number): Promise<string> {
  const targets = await fetchJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`);
  const target = pickPageTarget(targets);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No Chrome page target found on DevTools port ${port}`);
  }

  const cookies = await readCookiesFromTarget(target.webSocketDebuggerUrl);
  const ddbCookies = cookies.filter((cookie) => !cookie.domain || /dndbeyond\.com$/.test(cookie.domain));
  if (ddbCookies.length === 0) {
    throw new Error("No D&D Beyond cookies found. Complete login in the opened browser, then retry.");
  }

  return buildCookieHeader(ddbCookies);
}

async function readCookiesFromTarget(webSocketDebuggerUrl: string): Promise<CdpCookie[]> {
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

  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send("Network.enable");
  const result = await send("Network.getAllCookies");
  socket.close();
  return result.cookies ?? [];
}

async function waitForDevtools(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Chrome DevTools did not start on port ${port}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json() as T;
}

function defaultChromePath(): string {
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "chrome.exe";
  return "/usr/bin/google-chrome-stable";
}
