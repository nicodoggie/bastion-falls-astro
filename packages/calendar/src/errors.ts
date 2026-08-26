export class CalendarDefinitionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CalendarDefinitionError";
	}
}
