import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import AdmZip from "adm-zip";

export interface ZipEntry {
  path: string;
  name: string;
}

export async function createZipArchive(
  entries: ZipEntry[],
  outPath: string,
): Promise<void> {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addLocalFile(entry.path, "", entry.name);
  }
  await mkdir(dirname(outPath), { recursive: true });
  zip.writeZip(outPath);
}
