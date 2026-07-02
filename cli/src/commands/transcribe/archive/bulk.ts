export type ArchiveAllResult =
  | { status: "archived"; session: string; destination: string }
  | { status: "skipped"; session: string; destination: string }
  | { status: "failed"; session: string; error: string };

export function isExistingOutputSkip(options: {
  all: boolean;
  force?: boolean;
  destinationExists: boolean;
}): boolean {
  return options.all && !options.force && options.destinationExists;
}

export function formatArchiveSummary(results: ArchiveAllResult[]): string {
  const archived = results.filter((result) => result.status === "archived").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed");
  const lines = [
    "Archive summary:",
    `  Total: ${results.length}`,
    `  Archived: ${archived}`,
    `  Skipped existing: ${skipped}`,
    `  Failed: ${failed.length}`,
  ];

  if (failed.length > 0) {
    lines.push(
      "",
      "Failures:",
      ...failed.map((result) => `  - ${result.session}: ${result.error}`),
    );
  }

  return lines.join("\n");
}
