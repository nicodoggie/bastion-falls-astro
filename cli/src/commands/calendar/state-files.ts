import { randomUUID } from "node:crypto";
import { mkdir, open as openFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findUp } from "find-up";

export const FALLBACK_STATE_RELATIVE_PATH =
	"astro/src/data/bastion-calendar-state.json";
export const RESOLVED_STATE_RELATIVE_PATH =
	"astro/.astro/bastion-calendar-state.json";

export interface CalendarStatePaths {
	readonly repositoryRoot: string;
	readonly fallbackPath: string;
	readonly resolvedPath: string;
}

export async function resolveCalendarStatePaths(
	currentPath: unknown = process.cwd(),
): Promise<CalendarStatePaths> {
	if (typeof currentPath !== "string" || currentPath.trim() === "")
		throw new TypeError("currentPath must be a non-empty string");
	const marker = await findUp("pnpm-workspace.yaml", {
		cwd: resolve(currentPath),
	});
	if (marker === undefined)
		throw new Error("could not find pnpm-workspace.yaml");
	const repositoryRoot = dirname(marker);
	return {
		repositoryRoot,
		fallbackPath: join(repositoryRoot, FALLBACK_STATE_RELATIVE_PATH),
		resolvedPath: join(repositoryRoot, RESOLVED_STATE_RELATIVE_PATH),
	};
}

export interface AtomicWriteHandle {
	writeFile(
		data: string,
		options?: { encoding?: BufferEncoding },
	): Promise<void>;
	close(): Promise<void>;
}

export interface AtomicWriteOptions {
	readonly tempPath?: string;
	readonly open?: (path: string, flags: "wx") => Promise<AtomicWriteHandle>;
	readonly rename?: typeof rename;
	readonly mkdir?: typeof mkdir;
	readonly unlink?: typeof unlink;
	readonly beforeRename?: () => void | Promise<void>;
}

function targetPath(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "" || !isAbsolute(value))
		throw new TypeError("state path must be an absolute non-empty string");
	return value;
}

function stable(value: unknown, seen = new WeakSet<object>()): unknown {
	if (value === null || typeof value !== "object") {
		if (
			typeof value === "bigint" ||
			typeof value === "function" ||
			typeof value === "symbol" ||
			typeof value === "undefined"
		)
			throw new TypeError("state value must contain only JSON data");
		if (typeof value === "number" && !Number.isFinite(value))
			throw new TypeError("state value must contain finite numbers");
		return value;
	}
	if (seen.has(value))
		throw new TypeError("state value must not contain cycles");
	seen.add(value);
	const result = Array.isArray(value)
		? value.map((item) => stable(item, seen))
		: Object.fromEntries(
				Object.keys(value as Record<string, unknown>)
					.sort()
					.map((key) => [
						key,
						stable((value as Record<string, unknown>)[key], seen),
					]),
			);
	seen.delete(value);
	return result;
}

function serialized(value: unknown): string {
	try {
		const output = JSON.stringify(stable(value), null, 2);
		if (output === undefined)
			throw new TypeError("state value is not JSON serializable");
		return `${output}\n`;
	} catch (cause) {
		throw new TypeError("state value must be JSON serializable", { cause });
	}
}

export async function writeCalendarStateAtomically(
	destination: unknown,
	value: unknown,
	options: AtomicWriteOptions = {},
): Promise<void> {
	const target = targetPath(destination);
	if (typeof options !== "object" || options === null || Array.isArray(options))
		throw new TypeError("atomic write options must be an object");
	const text = serialized(value);
	const makeDir = options.mkdir ?? mkdir;
	const claim =
		options.open ??
		(async (path: string, flags: "wx") => openFile(path, flags));
	const replace = options.rename ?? rename;
	const remove = options.unlink ?? unlink;
	const temp =
		options.tempPath ?? `${target}.${process.pid}.${randomUUID()}.tmp`;
	if (!isAbsolute(temp) || dirname(temp) !== dirname(target))
		throw new TypeError(
			"temporary path must be an absolute sibling of destination",
		);
	await makeDir(dirname(target), { recursive: true });
	let handle: AtomicWriteHandle | undefined;
	let owned = false;
	try {
		handle = await claim(temp, "wx");
		owned = true;
		await handle.writeFile(text, { encoding: "utf8" });
		await handle.close();
		handle = undefined;
		await options.beforeRename?.();
		await replace(temp, target);
		owned = false;
	} finally {
		if (handle !== undefined) {
			try {
				await handle.close();
			} catch {
				/* preserve primary failure */
			}
		}
		if (owned) {
			try {
				await remove(temp);
			} catch {
				/* preserve primary failure */
			}
		}
	}
}
