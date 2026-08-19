export type FantasyCalendarFailureCategory =
	| "network"
	| "timeout"
	| "http"
	| "schema"
	| "unknown-era"
	| "date-epoch-disagreement"
	| "configuration";

export class FantasyCalendarError extends Error {
	readonly category: FantasyCalendarFailureCategory;
	attempts: number;
	elapsedMs: number;
	readonly status?: number;

	constructor(
		category: FantasyCalendarFailureCategory,
		message: string,
		attempts: number,
		elapsedMs: number,
		status?: number,
	) {
		super(message);
		this.name = "FantasyCalendarError";
		this.category = category;
		this.attempts = attempts;
		this.elapsedMs = elapsedMs;
		if (status !== undefined) this.status = status;
	}
}
