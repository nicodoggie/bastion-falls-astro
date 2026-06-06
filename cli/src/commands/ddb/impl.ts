import type { LocalContext } from "@/context.js";
import { getTargetPath } from "@/config.js";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { getDdbCookieHeader, launchChromeForDdbAuth } from "./browserAuth.js";
import {
  buildCharacterApiUrl,
  buildDefaultCharacterJsonPath,
  extractDdbCharacterPayload,
  parseDdbCharacterId,
  serializeDdbCharacterJson,
} from "./characterImport.js";

interface ImportCharacterFlags {
  out?: string;
  force?: boolean;
  port?: number;
  chrome?: string;
  profile?: string;
  useExistingChrome?: boolean;
}

export default async function importCharacter(this: LocalContext, flags: ImportCharacterFlags, urlOrId: string): Promise<void> {
  const characterId = parseDdbCharacterId(urlOrId);
  const port = flags.port ?? 9224;
  const sourceUrl = urlOrId.startsWith("http") ? urlOrId : `https://ddb.ac/characters/${characterId}`;
  const outputPath = flags.out
    ? resolve(this.currentPath, flags.out)
    : buildDefaultCharacterJsonPath(getTargetPath("characters"), characterId);

  if (!flags.force && await fileExists(outputPath)) {
    throw new Error(`${outputPath} already exists. Pass --force to overwrite.`);
  }

  if (!flags.useExistingChrome) {
    console.log(`Opening Chrome for D&D Beyond auth on DevTools port ${port}...`);
    await launchChromeForDdbAuth({
      chromePath: flags.chrome,
      port,
      profileDir: flags.profile,
      loginUrl: "https://www.dndbeyond.com/login",
    });
    console.log("Complete D&D Beyond login in the opened Chrome window, then press Enter here.");
    await waitForEnter();
  }

  const cookieHeader = await getDdbCookieHeader(port);
  const apiUrl = buildCharacterApiUrl(characterId);
  const response = await fetch(apiUrl, {
    headers: {
      accept: "application/json",
      cookie: cookieHeader,
      referer: `https://www.dndbeyond.com/characters/${characterId}`,
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`DDB character API returned ${response.status}: ${await response.text()}`);
  }

  const wrappedPayload = await response.json();
  const character = extractDdbCharacterPayload(wrappedPayload);
  const json = serializeDdbCharacterJson(character, {
    characterId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, "utf8");
  console.log(`Imported DDB character JSON to ${outputPath}`);
}

async function fileExists(path: string): Promise<boolean> {
  return await stat(path).then((info) => info.isFile()).catch(() => false);
}

async function waitForEnter(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log("stdin is not interactive; waiting 30 seconds before reading Chrome cookies.");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return;
  }

  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
  process.stdin.pause();
}
