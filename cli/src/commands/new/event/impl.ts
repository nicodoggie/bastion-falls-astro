import { z } from "zod";
import type { TemplateData } from "@/lib/template.js";

import { type Event, EventSchema } from "@bastion-falls/types";
import type { LocalContext } from "@/context.js";
import renderTemplate from "@/lib/template.js";
import type { NewEventCommandFlags } from "./command.js";
import { resolve } from "node:path";
import * as YAML from "js-yaml";

interface NewEventData extends TemplateData {
  event: Event;
}

export default async function event(
  this: LocalContext,
  flags: NewEventCommandFlags,
  articleName: string
): Promise<void> {
  const { description, type, dateStarted, dateEnded, locations, tags, force = false } = flags;

  const data: NewEventData = {
    title: articleName,
    description,
    event: {
      name: articleName,
      type,
      dateStarted,
      dateEnded,
      locations,
    },
    tags: ["events", ...(tags ?? [])],
  };

  try {
    const targetDir = resolve(this.rootDir, "../astro/src/content/docs/events")
    await renderTemplate({
      name: articleName,
      data: {
        title: articleName,
        data: YAML.dump(data),
      },
      template: "event",
      targetDir,
      force,
    });
    console.log(`Event "${articleName}" created successfully.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      if (!force) {
        throw new Error(`${error.message}. Use --force to overwrite.`);
      }
    } else {
      throw error;
    }

  }
}