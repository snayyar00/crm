import { Injectable, Logger } from "@nestjs/common";

/**
 * Reads a stored email and extracts COMMITMENTS - a concrete thing owed by us or
 * to us, carrying a date.
 *
 * Why this exists: the mailbox sync fetches mail, matches it to a company, stores
 * it and stamps lastActivityAt. Nothing ever read what the mail SAID. A customer
 * could write "I need the audit report by Friday" and the CRM would record only
 * that they had emailed. 0 of 55 tasks in production originated from an email.
 *
 * Measured on real mail before the thresholds below were added: 7 candidate
 * commitments from 10 emails - too many. The noise was calendar invites (already
 * covered by calendar sync, so they double up) and politeness read as obligation
 * ("please let us know if there is any update" scored 0.3).
 */

export interface ExtractedCommitment {
	owner: "us" | "them";
	title: string;
	dueDate: string;
	confidence: number;
	evidence: string;
}

/** Below this, a candidate is noise rather than a commitment. Tuned on real mail. */
export const MIN_CONFIDENCE = 0.7;

/**
 * Calendar invitations arrive as email AND as calendar events. The calendar sync
 * already creates the obligation, so extracting from the email duplicates it.
 */
const CALENDAR_MARKERS = [
	"invitation:",
	"accepted:",
	"declined:",
	"updated invitation",
	"canceled event",
	"you booked a meeting",
	"new meeting booked",
	"begin:vcalendar",
];

export const looksLikeCalendarInvite = (subject: string, body: string): boolean => {
	const hay = `${subject} ${body.slice(0, 400)}`.toLowerCase();
	return CALENDAR_MARKERS.some((m) => hay.includes(m));
};

const SYSTEM = (today: string) => `You extract COMMITMENTS from a business email for a CRM.
Today is ${today}.
A commitment is a concrete thing OWED by us (WebAbility) or OWED TO us, that has or implies a date.
Return STRICT JSON only: {"commitments":[{"owner":"us|them","title":"<=70 chars imperative","dueDate":"YYYY-MM-DD","confidence":0-1,"evidence":"<=90 chars quoted verbatim"}]}
Rules:
- No commitment -> {"commitments":[]}.
- NEVER invent a date. If it is only implied ("next week"), resolve from today and lower confidence.
- Newsletters, marketing, automated notifications, receipts -> empty array.
- evidence MUST be a verbatim quote from the email. If you cannot quote it, do not emit it.`;

@Injectable()
export class CommitmentExtractorService {
	private readonly logger = new Logger(CommitmentExtractorService.name);

	private get apiKey(): string {
		return process.env.AI_GATEWAY_API_KEY ?? "";
	}

	/** Returns [] whenever extraction is unavailable or unsafe - never throws into the sync. */
	async extract(input: {
		subject: string;
		body: string;
		fromEmail: string;
		companyName: string;
		sentAt: Date;
	}): Promise<ExtractedCommitment[]> {
		if (!this.apiKey) return [];
		if (looksLikeCalendarInvite(input.subject, input.body)) return [];

		const today = new Date().toISOString().slice(0, 10);
		const prompt = [
			`From: ${input.fromEmail}`,
			`Company: ${input.companyName}`,
			`Date sent: ${input.sentAt.toISOString().slice(0, 10)}`,
			`Subject: ${input.subject}`,
			"",
			input.body.slice(0, 4000),
		].join("\n");

		// One retry: a malformed-JSON response dropped the single most important
		// email in the trial run. A silent drop is worse than a second call.
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const raw = await this.call(SYSTEM(today), prompt);
				const parsed = this.parse(raw);
				if (parsed) return this.filter(parsed, today);
				this.logger.warn({ message: "Commitment JSON unparseable", attempt });
			} catch (error) {
				this.logger.warn({ message: "Commitment extraction failed", attempt, error });
			}
		}
		return [];
	}

	private async call(system: string, user: string): Promise<string> {
		const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: process.env.CRM_EXTRACTOR_MODEL ?? "anthropic/claude-sonnet-5",
				max_tokens: 600,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
			}),
		});
		if (!res.ok) throw new Error(`gateway ${res.status}`);
		const json = (await res.json()) as {
			choices?: { message?: { content?: string } }[];
		};
		return json.choices?.[0]?.message?.content ?? "";
	}

	/** Models wrap JSON in prose or fences often enough that this must be tolerant. */
	private parse(raw: string): ExtractedCommitment[] | null {
		const start = raw.indexOf("{");
		const end = raw.lastIndexOf("}");
		if (start < 0 || end <= start) return null;
		try {
			const obj = JSON.parse(raw.slice(start, end + 1)) as {
				commitments?: unknown;
			};
			return Array.isArray(obj.commitments)
				? (obj.commitments as ExtractedCommitment[])
				: [];
		} catch {
			return null;
		}
	}

	private filter(items: ExtractedCommitment[], today: string): ExtractedCommitment[] {
		return filterCommitments(items, today);
	}
}

/** Pure so the thresholds can be tested without a model call. */
export const filterCommitments = (
	items: ExtractedCommitment[],
	today: string,
): ExtractedCommitment[] =>
	items.filter((c) => {
		if (!c || typeof c.title !== "string" || !c.title.trim()) return false;
		if (typeof c.confidence !== "number" || c.confidence < MIN_CONFIDENCE) return false;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate ?? "")) return false;
		// A due date in the past is a misread, not a commitment we can act on.
		if (c.dueDate < today) return false;
		// evidence must exist - it is the only thing that makes a wrong extraction auditable
		if (!c.evidence || !c.evidence.trim()) return false;
		return true;
	});
