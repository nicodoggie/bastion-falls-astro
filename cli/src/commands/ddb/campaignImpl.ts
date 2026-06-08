import type { LocalContext } from "@/context.js";
import { getTargetPath } from "@/config.js";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { launchChromeForDdbAuth } from "./browserAuth.js";
import {
  buildDefaultCampaignJsonPath,
  parseDdbCampaignId,
  serializeDdbCampaignJson,
} from "./characterImport.js";
import { scrapeRenderedCampaignRoster } from "./renderedCampaign.js";

interface ImportCampaignFlags {
  out?: string;
  force?: boolean;
  port?: number;
  chrome?: string;
  profile?: string;
  useExistingChrome?: boolean;
}

export default async function importCampaign(this: LocalContext, flags: ImportCampaignFlags, urlOrId: string): Promise<void> {
  const campaignId = parseDdbCampaignId(urlOrId);
  const port = flags.port ?? 9224;
  const sourceUrl = urlOrId.startsWith("http") ? urlOrId : `https://www.dndbeyond.com/campaigns/${campaignId}`;
  const outputPath = flags.out
    ? resolve(this.currentPath, flags.out)
    : buildDefaultCampaignJsonPath(getTargetPath("characters"), campaignId);

  if (!flags.force && await fileExists(outputPath)) {
    throw new Error(`${outputPath} already exists. Pass --force to overwrite.`);
  }

  if (!flags.useExistingChrome) {
    console.log(`Opening Chrome for D&D Beyond auth on DevTools port ${port}...`);
    await launchChromeForDdbAuth({
      chromePath: flags.chrome,
      port,
      profileDir: flags.profile,
      loginUrl: sourceUrl,
    });
    console.log("Complete D&D Beyond login in the opened Chrome window, then press Enter here.");
    await waitForEnter();
  }

  const campaign = await scrapeRenderedCampaignRoster({ port, campaignId, sourceUrl });
  const json = serializeDdbCampaignJson(campaign, {
    campaignId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, "utf8");
  console.log(`Imported DDB campaign roster artifact to ${outputPath}`);
  console.log(`Discovered ${campaign.characters.length} character(s).`);
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
