import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export interface NotesIdentity {
  campaign: string;
  sessionDate: string;
}

export interface NotesPathOptions extends NotesIdentity {
  contextRoot: string;
}

function titleCaseCampaign(campaign: string): string {
  return campaign
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function getNotesPath(options: NotesPathOptions): string {
  return join(options.contextRoot, "world", "notes", options.campaign, `${options.sessionDate}.mdx`);
}

export function buildNotesFrontmatter(options: NotesIdentity): string {
  return [
    "---",
    `title: '${titleCaseCampaign(options.campaign)} Notes ${options.sessionDate}'`,
    "tags:",
    "  - notes",
    `  - ${options.campaign}`,
    "---",
    "",
  ].join("\n");
}

export async function writeNotesFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

