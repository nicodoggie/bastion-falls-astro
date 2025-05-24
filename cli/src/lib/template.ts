import * as ejs from "ejs";
import * as YAML from "js-yaml";
import { getAbsolutePath } from "esm-path";
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

    const currentFile = getAbsolutePath(import.meta.url);
    const buildtemplateFile = resolve(currentFile, `../templates/${template}.ejs`);
    const devTemplateFile = resolve(currentFile, `../../templates/${template}.ejs`);
    const target = resolve(targetDir, `${finalSlug}.${extension}`);

    const templateFileExists = await stat(buildtemplateFile)
      .then((info) => {
        return info.isFile();
      })
      .catch(() => {
        return false;
      });

    const devTemplateFileExists = await stat(devTemplateFile)
      .then((info) => {
        return info.isFile();
      })
      .catch(() => {
        return false;
      });

    const templateFile = templateFileExists ? buildtemplateFile : devTemplateFile;

    if (!templateFileExists && !devTemplateFileExists) {
      throw new Error(`Template file ${templateFile} does not exist`);
    }

    const content = await ejs.renderFile(templateFile, data);

    const fileExists = await stat(target)
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