import { describe, expect, it } from "bun:test";
import {
	type ExtractedCommitment,
	filterCommitments,
	looksLikeCalendarInvite,
	MIN_CONFIDENCE,
} from "../src/mailbox/commitment-extractor.service";

const TODAY = "2026-08-12";

const commitment = (
	over: Partial<ExtractedCommitment> = {},
): ExtractedCommitment => ({
	owner: "us",
	title: "Send the audit report",
	dueDate: "2026-08-20",
	confidence: 0.9,
	evidence: "we need the report by the 20th",
	...over,
});

describe("commitment extraction thresholds", () => {
	// Every case below is taken from a real dry run over production email.
	it("keeps a dated, well-evidenced commitment", () => {
		expect(filterCommitments([commitment()], TODAY)).toHaveLength(1);
	});

	it("drops politeness read as obligation - 'let us know if there is any update' scored 0.3", () => {
		const noise = commitment({
			title: "Provide update on tax return",
			confidence: 0.3,
		});
		expect(filterCommitments([noise], TODAY)).toEqual([]);
	});

	it("drops anything under the confidence floor, exactly at the boundary", () => {
		expect(
			filterCommitments(
				[commitment({ confidence: MIN_CONFIDENCE - 0.01 })],
				TODAY,
			),
		).toEqual([]);
		expect(
			filterCommitments([commitment({ confidence: MIN_CONFIDENCE })], TODAY),
		).toHaveLength(1);
	});

	it("drops a due date in the past - that is a misread, not work", () => {
		expect(
			filterCommitments([commitment({ dueDate: "2026-08-01" })], TODAY),
		).toEqual([]);
	});

	it("drops a malformed or invented date", () => {
		expect(
			filterCommitments([commitment({ dueDate: "next week" })], TODAY),
		).toEqual([]);
		expect(filterCommitments([commitment({ dueDate: "" })], TODAY)).toEqual([]);
	});

	it("requires evidence, because it is the only audit trail for a wrong extraction", () => {
		expect(filterCommitments([commitment({ evidence: "" })], TODAY)).toEqual(
			[],
		);
	});

	it("drops an empty title", () => {
		expect(filterCommitments([commitment({ title: "   " })], TODAY)).toEqual(
			[],
		);
	});
});

describe("calendar invites are excluded", () => {
	// These arrive as BOTH email and calendar event; calendar sync already creates
	// the obligation, so extracting from the email would duplicate every meeting.
	const invites: [string, string][] = [
		["Invitation: Riipen FuturePath Discovery @ Wed Sep 16", ""],
		["You booked a meeting with: Andrew Nguyen", ""],
		[
			"Re: something",
			"New Meeting Booked with Andrew Nguyen ... Date / time September 16",
		],
		["Accepted: WCAG sync", ""],
		["anything", "BEGIN:VCALENDAR\nVERSION:2.0"],
	];
	for (const [subject, body] of invites) {
		it(`treats ${JSON.stringify(subject)} as a calendar invite`, () => {
			expect(looksLikeCalendarInvite(subject, body)).toBe(true);
		});
	}

	it("does not mistake a real business email for an invite", () => {
		expect(
			looksLikeCalendarInvite(
				"Follow-Up Call on the Phased WCAG Audit Proposal",
				"Let us meet tomorrow to have a follow-up call on the phased WCAG proposal",
			),
		).toBe(false);
	});
});
