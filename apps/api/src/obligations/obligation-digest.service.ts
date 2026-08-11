import { InjectDatabase } from "../database/database.constants";
import { Injectable, Logger } from "@nestjs/common";
import type { Db } from "@crm/db";

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
const URGENT_DAYS = 3;
const TOP_N = 3;

type DueRow = {
	id: string;
	subject: string | null;
	dueAt: Date | null;
	meta: unknown;
	deal: { name: string; amount: unknown; stage: string } | null;
	company: { name: string } | null;
};

@Injectable()
export class ObligationDigestService {
	private readonly logger = new Logger(ObligationDigestService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	private daysFromNow(d: Date | null): number {
		if (!d) return Number.POSITIVE_INFINITY;
		return Math.floor((d.getTime() - Date.now()) / 86_400_000);
	}

	/** Overdue first, then soonest. Money is the tiebreak. */
	private rank(rows: DueRow[]): DueRow[] {
		return [...rows].sort((a, b) => {
			const da = this.daysFromNow(a.dueAt);
			const db_ = this.daysFromNow(b.dueAt);
			if (da !== db_) return da - db_;
			return Number(b.deal?.amount ?? 0) - Number(a.deal?.amount ?? 0);
		});
	}

	private line(r: DueRow): string {
		const days = this.daysFromNow(r.dueAt);
		const who = r.deal?.name ?? r.company?.name ?? "—";
		const money = r.deal?.amount ? ` $${Number(r.deal.amount).toLocaleString()}` : "";
		const age =
			days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "due today" : `${days} days left`;
		return `${who}${money} — ${age}. ${r.subject ?? ""}`.trim();
	}

	/**
	 * Returns null when there is nothing worth interrupting for. That null is the
	 * feature, not an empty case to be filled with reassurance.
	 */
	async build(): Promise<{ subject: string; body: string; count: number } | null> {
		const horizon = new Date(Date.now() + URGENT_DAYS * 86_400_000);
		const rows = (await this.db.activity.findMany({
			where: { type: "TASK", completedAt: null, dueAt: { lte: horizon } },
			orderBy: { dueAt: "asc" },
			include: {
				deal: { select: { name: true, amount: true, stage: true } },
				company: { select: { name: true } },
			},
		})) as unknown as DueRow[];

		const obligations = rows.filter(
			(r) => Boolean((r.meta as { obligationKind?: string } | null)?.obligationKind),
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
		const subject =
			leadDays < 0
				? `OVERDUE: ${lead.deal?.name ?? lead.company?.name ?? "obligation"} — ${Math.abs(leadDays)} days`
				: `Due now: ${lead.deal?.name ?? lead.company?.name ?? "obligation"}`;

		const body = [
			"Oldest first.",
			"",
			...top.map((r, i) => `${i + 1}. ${this.line(r)}`),
			...(rest > 0 ? ["", `(${rest} more not urgent yet — deliberately not listed.)`] : []),
		].join("\n");

		return { subject, body, count: obligations.length };
	}

	/**
	 * The install owner — this is single-tenant, so the first user IS the founder.
	 * Used as the EmailJob author; the alarm has no other sensible attribution.
	 */
	async ownerId(): Promise<string> {
		const user = await this.db.user.findFirst({ orderBy: { createdAt: "asc" } });
		if (!user) throw new Error("No user exists — cannot attribute the obligation alarm.");
		return user.id;
	}

	/**
	 * Enqueues the alarm if there is one. Returns what it did so a caller (cron,
	 * test) can assert on it rather than reading logs.
	 */
	async run(to: string, createdById: string) {
		const digest = await this.build();
		if (!digest) {
			this.logger.log({ message: "Nothing overdue or urgent — sending nothing." });
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

		this.logger.warn({ message: "Obligation alarm queued", subject: digest.subject, count: digest.count });
		return { sent: true as const, emailJobId: job.id, subject: digest.subject, count: digest.count };
	}
}
