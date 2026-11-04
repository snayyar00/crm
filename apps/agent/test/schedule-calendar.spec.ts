import { describe, expect, it } from "bun:test";
import { readAgentTriggerConfig } from "@crm/validation/agent-manifest";
import { nextScheduledRun } from "../agent/lib/schedule-calendar";

const EASTERN_WEEKDAYS = {
	timeZone: "America/New_York",
	daysOfWeek: [1, 2, 3, 4, 5],
};
const DAY_MINUTES = 1440;

function next(
	from: string,
	now: string,
	schedule: {
		intervalMinutes: number;
		timeZone?: string | null;
		daysOfWeek?: number[] | null;
	},
) {
	return nextScheduledRun(
		new Date(from),
		schedule,
		new Date(now),
	).toISOString();
}

describe("nextScheduledRun", () => {
	it("keeps a plain interval exactly as before", () => {
		expect(
			next("2026-11-05T14:00:00.000Z", "2026-11-05T14:00:30.000Z", {
				intervalMinutes: DAY_MINUTES,
			}),
		).toBe("2026-11-06T14:00:00.000Z");
	});

	it("skips every missed interval on a plain schedule", () => {
		expect(
			next("2026-11-05T14:00:00.000Z", "2026-11-08T15:00:00.000Z", {
				intervalMinutes: DAY_MINUTES,
			}),
		).toBe("2026-11-09T14:00:00.000Z");
	});

	it("moves a Friday run to Monday", () => {
		expect(
			next("2026-11-06T14:00:00.000Z", "2026-11-06T14:00:30.000Z", {
				intervalMinutes: DAY_MINUTES,
				...EASTERN_WEEKDAYS,
			}),
		).toBe("2026-11-09T14:00:00.000Z");
	});

	it("keeps 9am local across spring forward", () => {
		expect(
			next("2027-03-12T14:00:00.000Z", "2027-03-12T14:00:30.000Z", {
				intervalMinutes: DAY_MINUTES,
				...EASTERN_WEEKDAYS,
			}),
		).toBe("2027-03-15T13:00:00.000Z");
	});

	it("keeps 9am local across fall back", () => {
		expect(
			next("2026-10-30T13:00:00.000Z", "2026-10-30T13:00:30.000Z", {
				intervalMinutes: DAY_MINUTES,
				...EASTERN_WEEKDAYS,
			}),
		).toBe("2026-11-02T14:00:00.000Z");
	});

	it("lands a long outage on the next allowed day", () => {
		expect(
			next("2026-11-05T14:00:00.000Z", "2026-11-07T16:00:00.000Z", {
				intervalMinutes: DAY_MINUTES,
				...EASTERN_WEEKDAYS,
			}),
		).toBe("2026-11-09T14:00:00.000Z");
	});

	it("uses the local day, not the UTC day, for a late evening run", () => {
		expect(
			next("2026-11-07T01:00:00.000Z", "2026-11-07T01:00:30.000Z", {
				intervalMinutes: DAY_MINUTES,
				...EASTERN_WEEKDAYS,
			}),
		).toBe("2026-11-10T01:00:00.000Z");
	});

	it("runs every day when a time zone has no day list", () => {
		expect(
			next("2027-03-13T14:00:00.000Z", "2027-03-13T14:00:30.000Z", {
				intervalMinutes: DAY_MINUTES,
				timeZone: "America/New_York",
			}),
		).toBe("2027-03-14T13:00:00.000Z");
	});

	it("advances a multi-day schedule by whole local days", () => {
		expect(
			next("2027-03-08T14:00:00.000Z", "2027-03-08T14:00:30.000Z", {
				intervalMinutes: DAY_MINUTES * 7,
				timeZone: "America/New_York",
			}),
		).toBe("2027-03-15T13:00:00.000Z");
	});
});

describe("readAgentTriggerConfig", () => {
	it("reads an old row with no calendar fields", () => {
		expect(readAgentTriggerConfig({ intervalMinutes: DAY_MINUTES })).toEqual({
			intervalMinutes: DAY_MINUTES,
			event: null,
			timeZone: null,
			daysOfWeek: null,
		});
	});

	it("reads the calendar fields", () => {
		expect(
			readAgentTriggerConfig({
				nextRunAt: "2026-11-05T14:00:00.000Z",
				intervalMinutes: DAY_MINUTES,
				...EASTERN_WEEKDAYS,
			}),
		).toEqual({
			intervalMinutes: DAY_MINUTES,
			event: null,
			...EASTERN_WEEKDAYS,
		});
	});

	it("drops an unreadable calendar field and keeps the interval", () => {
		expect(
			readAgentTriggerConfig({
				intervalMinutes: DAY_MINUTES,
				timeZone: 5,
				daysOfWeek: [9],
			}),
		).toEqual({
			intervalMinutes: DAY_MINUTES,
			event: null,
			timeZone: null,
			daysOfWeek: null,
		});
	});
});
