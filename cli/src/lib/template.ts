import * as ejs from "ejs";
import { slug } from "github-slugger";
import { writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

interface RenderTemplateOptions {
  name: string;
  template: string;
  targetDir: string;
  force?: boolean;
  extension?: string;
  data: TemplateData;
  slugger?: (str: string) => string;
}

export interface TemplateData {
  title?: string;
  slug?: string;
  [key: string]: any;
}

export default async function renderTemplate(options: RenderTemplateOptions) {
  const {
    name,
    template,
    data,
    targetDir,
    slugger,
    force = false,
    extension = "mdx",
  } = {
    ...options,
    slugger: options.slugger ?? slug,
  };

  try {
    if (!data.title) {
      data.title = name;
    }

    let finalSlug = data.slug;
    if (!finalSlug) {
      finalSlug = slugger(data.title);
    }

    const content = await ejs.renderFile(template, data);
    const target = resolve(targetDir, `${finalSlug}.${extension}`);

    const fileExists = stat(target)
      .then((info) => {
        return info.isFile();
      })
      .catch(() => {
        return false;
      });

    if (force || !fileExists) {
      await writeFile(target, content);
    } else {
      throw new Error(`${target} already exists`);
    }
  } catch (error) {
    throw error;
  }
}