import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	daysUntil,
	IRREVERSIBLE,
	leadDaysFor,
	MAX_LEAD_DAYS,
} from "./obligations.service";

/**
 * The morning alarm for dated obligations.
 *
 * NOT a daily digest. A digest that arrives every morning containing "due in 14
 * days" teaches you within a week that it is skippable, and then the one carrying
 * a 23-day-overdue signed contract gets archived with the rest. So:
 *
 *   - It sends ONLY when something is overdue or inside URGENT_DAYS.
 *     A clean day sends nothing at all. Silence means you are clean, which makes
 *     every arrival a real alarm.
 *   - It carries at most TOP_N items. A list of twelve is a dashboard in email
 *     form, and dashboards are what this exists to replace.
 *   - The subject names ONE thing, with its money and its age.
 *
 * Delivery goes through EmailJob for retries and logging, but is enqueued QUEUED
 * rather than DRAFT. The DRAFT gate exists so a human approves outbound CUSTOMER
 * mail; this is internal mail to the founder, and making him release it to himself
 * would deadlock on the very inattention it is built to fix. The recipient is
 * pinned to DIGEST_TO for exactly that reason — this bypass must never be able to
 * address a customer.
 */
const TOP_N = 3;

type DueRow = {
	id: string;
	subject: string | null;
	dueAt: Date | null;
	meta: unknown;
	deal: {
		name: string;
		amount: unknown;
		stage: string;
		engagementType?: string | null;
		workStartedAt?: Date | null;
	} | null;
	company: { name: string } | null;
};

@Injectable()
export class ObligationDigestService {
	private readonly logger = new Logger(ObligationDigestService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	private daysFromNow(d: Date | null): number {
		return daysUntil(d);
	}

	private kindOf(r: DueRow): string | undefined {
		return (r.meta as { obligationKind?: string } | null)?.obligationKind;
	}

	private leadFor(r: DueRow): number {
		return leadDaysFor(this.kindOf(r));
	}

	/**
	 * Days of slack left: how long you can still ignore this before you have less
	 * runway than the kind needs. Negative means you are already inside the window.
	 * This is what makes a trial at +12 days (14 needed, slack -2) outrank a
	 * deliverable at +2 days (3 needed, slack -1) — the trial is further past the
	 * point where work had to start, even though it is due later.
	 */
	private slack(r: DueRow): number {
		return this.daysFromNow(r.dueAt) - this.leadFor(r);
	}

	private isIrreversible(r: DueRow): boolean {
		return IRREVERSIBLE.has(this.kindOf(r) ?? "");
	}

	/**
	 * Two tiers: everything that LAPSES outranks everything that is merely late.
	 * Within a tier, least slack first (overdue sorts first naturally); money is
	 * the tiebreak. If three lapsing obligations ever fill the whole shortlist and
	 * push out an overdue deliverable, that is the correct email, not a bug.
	 */
	private rank(rows: DueRow[]): DueRow[] {
		return [...rows].sort((a, b) => {
			const ia = this.isIrreversible(a) ? 0 : 1;
			const ib = this.isIrreversible(b) ? 0 : 1;
			if (ia !== ib) return ia - ib;
			const sa = this.slack(a);
			const sb = this.slack(b);
			if (sa !== sb) return sa - sb;
			return Number(b.deal?.amount ?? 0) - Number(a.deal?.amount ?? 0);
		});
	}

	private line(r: DueRow): string {
		const days = this.daysFromNow(r.dueAt);
		const who = r.deal?.name ?? r.company?.name ?? "—";
		const money = r.deal?.amount
			? ` $${Number(r.deal.amount).toLocaleString()}`
			: "";
		const age =
			days < 0
				? `${Math.abs(days)} days overdue`
				: days === 0
					? "due today"
					: `${days} days left`;
		return `${who}${money} — ${age}. ${r.subject ?? ""}`.trim();
	}

	/**
	 * Returns null when there is nothing worth interrupting for. That null is the
	 * feature, not an empty case to be filled with reassurance.
	 */
	async build(): Promise<{
		subject: string;
		body: string;
		count: number;
	} | null> {
		// Fetch to the WIDEST lead time, then filter each row against its own. A
		// single narrow horizon would drop a trial that is 12 days out before the
		// per-kind rule ever saw it.
		const horizon = new Date(Date.now() + MAX_LEAD_DAYS * 86_400_000);
		const rows = (await this.db.activity.findMany({
			where: { type: "TASK", completedAt: null, dueAt: { lte: horizon } },
			orderBy: { dueAt: "asc" },
			include: {
				deal: {
					select: {
						name: true,
						amount: true,
						stage: true,
						engagementType: true,
						workStartedAt: true,
					},
				},
				company: { select: { name: true } },
			},
		})) as unknown as DueRow[];

		const obligations = rows.filter(
			(r) =>
				Boolean(this.kindOf(r)) &&
				this.slack(r) <= 0 &&
				// Never alarm about an audit deliverable whose work has not started.
				// Its date is a placeholder until the customer returns what we asked
				// for, and shouting about it trains the founder to distrust the alarm
				// for the things that ARE his to answer for.
				!(
					r.deal?.engagementType === "AUDIT" &&
					!r.deal?.workStartedAt &&
					this.kindOf(r) !== "TRIAL_EXPIRY"
				),
		);
		if (obligations.length === 0) return null;

		const ranked = this.rank(obligations);
		const top = ranked.slice(0, TOP_N);
		const rest = ranked.length - top.length;

		// top[0] exists — obligations.length === 0 returned above — but the compiler
		// cannot see that, and asserting it with `!` would hide a real regression if
		// the guard above ever changed.
		const lead = top[0];
		if (!lead) return null;
		const leadDays = this.daysFromNow(lead.dueAt);
		const who = lead.deal?.name ?? lead.company?.name ?? "obligation";
		// Say the real number of days. "Due now" on something 12 days out reads as
		// a lie the first time it is checked, and then the alarm is not believed.
		const subject =
			leadDays < 0
				? `OVERDUE: ${who} — ${Math.abs(leadDays)} days`
				: leadDays === 0
					? `Due today: ${who}`
					: `Act now: ${who} — ${leadDays} days left`;

		const body = [
			"What lapses first, then what runs out of time to act on first.",
			"",
			...top.map((r, i) => `${i + 1}. ${this.line(r)}`),
			// NOT "not urgent yet". Every hidden row is already past its lead time —
			// that is the filter that let it into this list at all. The old copy was
			// left over from the single 3-day window and would have described an
			// overdue signed-contract deliverable as fine.
			...(rest > 0
				? ["", `(${rest} more also past their lead time — open the CRM.)`]
				: []),
		].join("\n");

		return { subject, body, count: obligations.length };
	}

	/**
	 * The install owner — this is single-tenant, so the first user IS the founder.
	 * Used as the EmailJob author; the alarm has no other sensible attribution.
	 */
	async ownerId(): Promise<string> {
		const user = await this.db.user.findFirst({
			orderBy: { createdAt: "asc" },
		});
		if (!user)
			throw new Error(
				"No user exists — cannot attribute the obligation alarm.",
			);
		return user.id;
	}

	/**
	 * Enqueues the alarm if there is one. Returns what it did so a caller (cron,
	 * test) can assert on it rather than reading logs.
	 */
	async run(to: string, createdById: string) {
		const digest = await this.build();
		if (!digest) {
			this.logger.log({
				message: "Nothing overdue or urgent — sending nothing.",
			});
			return { sent: false as const, reason: "clean" };
		}

		const job = await this.db.emailJob.create({
			data: {
				to: [to],
				cc: [],
				subject: digest.subject,
				body: digest.body,
				// QUEUED, not DRAFT: see the class comment. Internal only.
				status: "QUEUED",
				createdById,
			},
		});

		this.logger.warn({
			message: "Obligation alarm queued",
			subject: digest.subject,
			count: digest.count,
		});
		return {
			sent: true as const,
			emailJobId: job.id,
			subject: digest.subject,
			count: digest.count,
		};
	}
}
