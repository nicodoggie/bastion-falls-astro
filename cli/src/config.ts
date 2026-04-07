import { findUp } from "find-up";
import yaml from "js-yaml";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const realCwd = process.env['_REAL_CWD'] || process.cwd();
const localConfigPath = await findUp(".bfcli.yml", { cwd: realCwd });
let localConfig: Record<string, any> = {};

if (localConfigPath) {
  localConfig = yaml.load(await readFile(localConfigPath, "utf8")) as Record<string, any>;
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