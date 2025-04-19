import fs from "node:fs";
import path from "node:path";
import * as toml from "smol-toml";
import yaml from "js-yaml";
import matter from "gray-matter";

export const options = {
  delimiters: "+++",
  language: "toml",
  engines: {
    toml: {
      parse: (data) => {
        return toml.parse(data);
      },
      stringify: (data) => {
        delete data._directory;

        if (data.slug === undefined) {
          delete data.slug;
        }
        return json2toml(data);
      },
    },
  },
};

// --- Configuration ---
const sourceBaseDir = path.resolve("../bastion-falls/site/content"); // Adjust if your Zola project is elsewhere
const targetDocsBaseDir = path.resolve(
  "../bastion-falls-astro/src/content/docs"
); // Starlight docs directory
const targetBlogBaseDir = path.resolve(
  "../bastion-falls-astro/src/content/blog"
); // Blog collection directory
// --- End Configuration ---

const ZOLA_LINK_REGEX = /\(@\/([^)]+?\.md(?:#[^)]*)?)\)/g;

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

// Recursive function to fix date strings within an object/array
function fixDatesRecursive(data) {
  if (typeof data === "string") {
    if (data.startsWith("date#")) {
      return data.substring(5) + " AI";
    }
    return data;
  } else if (Array.isArray(data)) {
    return data.map((item) => fixDatesRecursive(item));
  } else if (typeof data === "object" && data !== null) {
    const newData = {};
    for (const key in data) {
      newData[key] = fixDatesRecursive(data[key]);
    }
    return newData;
  }
  return data; // Return numbers, booleans, null as is
}

function migrateFile(sourceFilePath) {
  console.log(`Processing: ${sourceFilePath}`);

  // Calculate relative path from source base
  let relativePath = path.relative(sourceBaseDir, sourceFilePath);

  // Determine target base directory (docs or blog)
  const isBlog = relativePath.startsWith("blog" + path.sep);
  let currentTargetBaseDir = isBlog ? targetBlogBaseDir : targetDocsBaseDir;
  let relativeToCollectionDir = isBlog
    ? path.relative("blog", relativePath)
    : relativePath;

  // Calculate target filename and path
  const parsedPath = path.parse(relativeToCollectionDir);
  let targetFilename;
  if (parsedPath.base === "_index.md") {
    targetFilename = "index.mdx";
  } else {
    targetFilename = `${parsedPath.name}.mdx`;
  }
  const targetFilePath = path.join(
    currentTargetBaseDir,
    parsedPath.dir,
    targetFilename
  );

  try {
    const fileContent = fs.readFileSync(sourceFilePath, "utf8");

    // Split frontmatter and body
    const { data: zolaFmData, content: body } = matter(fileContent, options);

    if (!zolaFmData) {
      console.warn(
        `  [Warning] No TOML frontmatter found in ${sourceFilePath}`
      );
    }

    // Transform Frontmatter
    const astroFmData = {};
    astroFmData.title =
      zolaFmData.title ||
      path.basename(relativePath, ".md").replace(/[-_]/g, " "); // Fallback title

    // Map dates
    if (zolaFmData.date) {
      // Ensure date is treated as a string, handle potential Date objects from TOML parser if necessary
      astroFmData.date = String(zolaFmData.date);
    }
    if (zolaFmData.updated) {
      astroFmData.updatedDate = String(zolaFmData.updated);
    }

    // Basic description (optional, customize as needed)
    if (zolaFmData.description) {
      astroFmData.description = zolaFmData.description;
    } else if (isBlog) {
      astroFmData.description = "";
    }

    astroFmData.tags = [];
    const parentDir = path.basename(path.dirname(relativePath));
    if (parentDir && parentDir !== ".") {
      // Use parent directory name as a primary tag
      astroFmData.tags.push(parentDir);
    }

    if (zolaFmData.taxonomies) {
      for (const taxType in zolaFmData.taxonomies) {
        if (Array.isArray(zolaFmData.taxonomies[taxType])) {
          // Optionally prefix the tag with the taxonomy type, e.g., "event_type:Conference"
          // zolaFmData.taxonomies[taxType].forEach(val => astroFmData.tags.push(`${taxType}:${val}`));
          // Or just add the value directly:
          zolaFmData.taxonomies[taxType].forEach((val) =>
            astroFmData.tags.push(val)
          );
        }
      }
      // Remove duplicates
      astroFmData.tags = [...new Set(astroFmData.tags)];
    }

    // --- Generalized Handling for 'extra' block ---
    if (zolaFmData.extra) {
      // Deep copy the extra data
      const rawExtraData = JSON.parse(JSON.stringify(zolaFmData.extra));
      // Recursively fix date strings within the copied data
      astroFmData.extraMetadata = fixDatesRecursive(rawExtraData);
    }
    // --- End of generalized handling ---

    // Transform Body Links
    const transformedBody = body.replace(
      ZOLA_LINK_REGEX,
      (match, zolaLinkPath) => {
        const [linkPathOnly, anchor] = zolaLinkPath.split("#");
        const linkPathBase = linkPathOnly.replace(/\.md$/, "");

        const absoluteSourceLinkPath = path.resolve(
          sourceBaseDir,
          `${linkPathBase}.md`
        );
        let relativeSourceLinkPath = path.relative(
          sourceBaseDir,
          absoluteSourceLinkPath
        );

        // Determine if the *linked* file is blog or docs
        const isLinkToBlog = relativeSourceLinkPath.startsWith(
          "blog" + path.sep
        );
        let targetLinkCollectionBaseDir = isLinkToBlog
          ? targetBlogBaseDir
          : targetDocsBaseDir;
        let relativeLinkToCollectionDir = isLinkToBlog
          ? path.relative("blog", relativeSourceLinkPath)
          : relativeSourceLinkPath;

        // Adjust for index files and change extension for the TARGET structure (.mdx)
        const parsedSourceLinkPath = path.parse(relativeLinkToCollectionDir);
        let targetLinkFilename;
        if (parsedSourceLinkPath.base === "_index.md") {
          targetLinkFilename = "index.mdx";
        } else {
          targetLinkFilename = `${parsedSourceLinkPath.name}.mdx`;
        }
        const relativeTargetLinkPath = path.join(
          parsedSourceLinkPath.dir,
          targetLinkFilename
        );

        // Calculate the relative path FROM the current file's TARGET location TO the linked file's TARGET location
        const currentFileTargetDir = path.dirname(targetFilePath);
        // NOTE: We need the *absolute* path of the linked file in the target structure
        const linkedFileTargetAbsPath = path.join(
          targetLinkCollectionBaseDir, // Use the correct base dir (blog or docs)
          relativeTargetLinkPath
        );

        let relativeMdLink = path.relative(
          currentFileTargetDir,
          linkedFileTargetAbsPath
        );

        // Ensure relative paths start correctly for markdown
        if (
          !relativeMdLink.startsWith(".") &&
          !relativeMdLink.startsWith("/")
        ) {
          relativeMdLink = "./" + relativeMdLink;
        }

        // Append anchor if it exists
        if (anchor) {
          relativeMdLink += `#${anchor}`;
        }

        console.log(
          `    Rewriting link: @/${zolaLinkPath} -> ${relativeMdLink}`
        );
        return `(${relativeMdLink})`; // Return the updated link in markdown format
      }
    );

    // Combine and Write Output
    const yamlFmString = yaml.dump(astroFmData);
    const outputContent = `---
${yamlFmString}---

${transformedBody}`;

    ensureDirectoryExistence(targetFilePath);
    fs.writeFileSync(targetFilePath, outputContent, "utf8");
    console.log(`  -> Created: ${targetFilePath}`);
  } catch (err) {
    console.error(`  [Error] Failed to process ${sourceFilePath}:`, err);
  }
}

function walkDir(dir) {
  fs.readdirSync(dir).forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file !== "themes" && file !== "static" && file !== "sass") {
        walkDir(fullPath);
      }
    } else {
      // It's a file
      const relativePath = path.relative(sourceBaseDir, fullPath);
      const isBlogFile = relativePath.startsWith("blog" + path.sep);
      const currentTargetBaseDir = isBlogFile
        ? targetBlogBaseDir
        : targetDocsBaseDir;

      if (path.extname(file) === ".md") {
        migrateFile(fullPath); // migrateFile now knows how to determine target dir
      } else {
        // Copy assets, respecting blog/docs separation
        const relativeToCollectionDir = isBlogFile
          ? path.relative("blog", relativePath)
          : relativePath;
        const targetAssetPath = path.join(
          currentTargetBaseDir,
          relativeToCollectionDir
        );
        console.log(`Copying asset: ${fullPath}`);
        try {
          ensureDirectoryExistence(targetAssetPath);
          fs.copyFileSync(fullPath, targetAssetPath);
          console.log(`  -> Copied to: ${targetAssetPath}`);
        } catch (err) {
          console.error(`  [Error] Failed to copy asset ${fullPath}:`, err);
        }
      }
    }
  });
}

// --- Execution ---
if (!fs.existsSync(sourceBaseDir)) {
  console.error(`Source directory does not exist: ${sourceBaseDir}`);
  process.exit(1);
}
// Ensure both target directories exist
if (!fs.existsSync(targetDocsBaseDir)) {
  console.log(
    `Target directory does not exist, creating: ${targetDocsBaseDir}`
  );
  fs.mkdirSync(targetDocsBaseDir, { recursive: true });
}
if (!fs.existsSync(targetBlogBaseDir)) {
  console.log(
    `Target directory does not exist, creating: ${targetBlogBaseDir}`
  );
  fs.mkdirSync(targetBlogBaseDir, { recursive: true });
}

console.log(
  `Starting migration from ${sourceBaseDir} to ${targetDocsBaseDir} and ${targetBlogBaseDir}`
);
walkDir(sourceBaseDir);
console.log("Migration complete.");
console.log(
  "Remember to install dependencies: npm install toml js-yaml (or pnpm/yarn)"
);
console.log("Run this script using: node migration-scripts/zola-to-astro.mjs");
