import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findUp } from "find-up";
import yaml from "js-yaml";

const realCwd = process.env["_REAL_CWD"] || process.cwd();
const localConfigPath = await findUp(".bfcli.yml", { cwd: realCwd });
let localConfig: Record<string, any> = {};

if (localConfigPath) {
  localConfig = yaml.load(await readFile(localConfigPath, "utf8")) as Record<
    string,
    any
  >;
}

export const config = {
  contentDir: realCwd,
  ...localConfig,
};

export function getContentDir() {
  if (localConfigPath) {
    return resolve(dirname(localConfigPath), config.contentDir);
  }
  return config.contentDir;
}

export function getTargetPath(target: string) {
  return resolve(getContentDir(), target);
}

export function getConfigBaseDir(): string {
  return localConfigPath ? dirname(localConfigPath) : realCwd;
}

export function getTranscribeConfig(): Record<string, any> {
  // `config` is typed as `{ contentDir: string }` (spreading a Record does not
  // propagate an index signature under this package's compiler), so cast to
  // read the arbitrary `transcribe` key.
  const value = (config as Record<string, any>)["transcribe"];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
