const MINUTE_MS = 60_000;
export const DAY_MINUTES = 1440;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export type ScheduleRecurrence = {
	intervalMinutes: number;
	timeZone?: string | null;
	daysOfWeek?: number[] | null;
};

type WallClock = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

function wallClock(instant: Date, timeZone: string): WallClock {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((entry) => entry.type === type)?.value);

	return {
		year: part("year"),
		month: part("month"),
		day: part("day"),
		hour: part("hour"),
		minute: part("minute"),
		second: part("second"),
	};
}

function wallClockUtc(clock: WallClock): number {
	return Date.UTC(
		clock.year,
		clock.month - 1,
		clock.day,
		clock.hour,
		clock.minute,
		clock.second,
	);
}

function offsetMs(instant: number, timeZone: string): number {
	const wholeSeconds = Math.floor(instant / 1000) * 1000;
	return (
		wallClockUtc(wallClock(new Date(wholeSeconds), timeZone)) - wholeSeconds
	);
}

function zonedInstant(clock: WallClock, timeZone: string): Date {
	const local = wallClockUtc(clock);
	const estimate = local - offsetMs(local, timeZone);
	return new Date(local - offsetMs(estimate, timeZone));
}

export function localDayOfWeek(instant: Date, timeZone: string): number {
	const { year, month, day } = wallClock(instant, timeZone);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nextIntervalRun(from: Date, intervalMinutes: number, now: Date): Date {
	const intervalMs = intervalMinutes * MINUTE_MS;
	const missed = Math.max(
		1,
		Math.floor((now.getTime() - from.getTime()) / intervalMs) + 1,
	);
	return new Date(from.getTime() + missed * intervalMs);
}

export function nextScheduledRun(
	from: Date,
	schedule: ScheduleRecurrence,
	now: Date,
): Date {
	const { intervalMinutes, timeZone, daysOfWeek } = schedule;
	if (!timeZone || intervalMinutes % DAY_MINUTES !== 0) {
		return nextIntervalRun(from, intervalMinutes, now);
	}

	const stepDays = intervalMinutes / DAY_MINUTES;
	const allowed = new Set(stepDays === 1 ? (daysOfWeek ?? ALL_DAYS) : ALL_DAYS);
	const clock = wallClock(from, timeZone);
	const elapsedSteps = Math.floor(
		(now.getTime() - from.getTime()) / (intervalMinutes * MINUTE_MS),
	);
	let dayOffset = Math.max(1, elapsedSteps) * stepDays;
	const candidateAt = (offset: number) => {
		const date = new Date(
			Date.UTC(clock.year, clock.month - 1, clock.day + offset),
		);
		return {
			dayOfWeek: date.getUTCDay(),
			instant: zonedInstant(
				{
					...clock,
					year: date.getUTCFullYear(),
					month: date.getUTCMonth() + 1,
					day: date.getUTCDate(),
				},
				timeZone,
			),
		};
	};

	let candidate = candidateAt(dayOffset);
	while (candidate.instant <= now || !allowed.has(candidate.dayOfWeek)) {
		dayOffset += stepDays;
		candidate = candidateAt(dayOffset);
	}
	return candidate.instant;
}
