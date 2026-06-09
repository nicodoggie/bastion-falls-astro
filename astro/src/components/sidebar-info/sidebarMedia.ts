import path from "node:path";
import type { Image } from "@bastion-falls/types/Image";

export function normalizeSidebarImages(
  image: Image | Image[] | undefined,
): Image[] {
  if (!image) return [];
  return Array.isArray(image) ? image : [image];
}

export function resolveSidebarImageUrl(
  url: string | undefined,
  entryFilePath?: string,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return url;

  if ((url.startsWith("./") || url.startsWith("../")) && entryFilePath) {
    const directory = path.posix.dirname(`/${entryFilePath}`);
    return path.posix.normalize(path.posix.join(directory, url));
  }

  return url;
}
