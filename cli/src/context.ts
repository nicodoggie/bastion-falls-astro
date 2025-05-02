import type { CommandContext } from "@stricli/core";
import type { StricliAutoCompleteContext } from "@stricli/auto-complete";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LocalContext
  extends CommandContext,
  StricliAutoCompleteContext {
  readonly process: NodeJS.Process;
  readonly rootDir: string;
}

export function buildContext(process: NodeJS.Process): LocalContext {
  const fileUrl = new URL(import.meta.url);


  return {
    rootDir: path.resolve(path.dirname(fileUrl.pathname), ".."),
    process,
    os,
    fs,
    path,
  };
}
