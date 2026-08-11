import { InjectDatabase } from "../database/database.constants";
import { Injectable, Logger } from "@nestjs/common";
import type { Db } from "@crm/db";

/**
 * Dated obligations — the clocks an accessibility business runs on.
 *
 * NOT a new table. An obligation is an Activity of type TASK carrying
 * `meta.obligationKind`. The Commitment table was cut for the same reason: a
 * second obligation list is how the first one stopped being drained.
 *
 * What makes these different from an ordinary task is LIFECYCLE, and that lives
 * here rather than in the schema:
 *   - TRIAL_EXPIRY does not "complete" — it lapses, and lapsing is the alarm.
 *   - RECHECK_DUE regenerates: closing one spawns the next.
 *   - VPAT_EXPIRY supersedes: a new version closes the old clock and opens one.
 *
 * If these rows were only ever hand-typed, the kind would be decoration. They are
 * created from events instead — see spawnForWonDeal and spawnForTrial.
 */
export type ObligationKind =
	| "TRIAL_EXPIRY"
	| "RECHECK_DUE"
	| "VPAT_EXPIRY"
	| "DELIVERABLE_DUE"
	| "LEGAL_DEADLINE";

/** The five deliverables every audit engagement contractually includes. */
const AUDIT_DELIVERABLES = [
	{ title: "Audit report", offsetDays: 14 },
	{ title: "VPAT / Accessibility Conformance Report", offsetDays: 21 },
	{ title: "Accessibility statement", offsetDays: 21 },
	{ title: "Remediation verification", offsetDays: 45 },
] as const;

/** Contractual re-check interval for audit engagements. */
const RECHECK_MONTHS = 6;

@Injectable()
export class ObligationsService {
	private readonly logger = new Logger(ObligationsService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	private addDays(from: Date, days: number): Date {
		const d = new Date(from);
		d.setDate(d.getDate() + days);
		return d;
	}

	private addMonths(from: Date, months: number): Date {
		const d = new Date(from);
		d.setMonth(d.getMonth() + months);
		return d;
	}

	/**
	 * Idempotent by (dealId, kind, title): re-running a spawn never duplicates.
	 * Deliberate — this is called from a deal event that can fire more than once.
	 */
	private async ensure(input: {
		kind: ObligationKind;
		title: string;
		body: string;
		dueAt: Date;
		dealId?: string;
		companyId?: string;
		createdById: string;
	}) {
		const existing = await this.db.activity.findFirst({
			where: { type: "TASK", subject: input.title, dealId: input.dealId ?? undefined },
		});
		// Report creation explicitly. Inferring it from `createdAt > now - 5s` looked
		// right and was wrong: a re-run inside that window counted existing rows as new,
		// so an idempotency check reported 5 created when it had created none.
		if (existing) return { row: existing, created: false };

		const row = await this.db.activity.create({
			data: {
				type: "TASK",
				subject: input.title,
				body: input.body,
				dueAt: input.dueAt,
				occurredAt: new Date(),
				dealId: input.dealId,
				companyId: input.companyId,
				createdById: input.createdById,
				meta: { obligationKind: input.kind, spawnedBy: "obligations.service" },
			},
		});
		return { row, created: true };
	}

	/**
	 * A won audit deal carries five contractual obligations. They are identical
	 * every time, which is exactly why they are forgettable: Questback signed on
	 * 2026-07-14 and 23 days later none of them had been started.
	 */
	async spawnForWonDeal(dealId: string, createdById: string) {
		const deal = await this.db.deal.findUnique({ where: { id: dealId } });
		if (!deal) return { created: 0, reason: "no such deal" };

		const from = deal.closedAt ?? deal.stageChangedAt ?? new Date();
		let created = 0;

		for (const d of AUDIT_DELIVERABLES) {
			const row = await this.ensure({
				kind: "DELIVERABLE_DUE",
				title: `${d.title} — ${deal.name}`,
				body: `Contractual deliverable for ${deal.name}. Due ${d.offsetDays} days from close.`,
				dueAt: this.addDays(from, d.offsetDays),
				dealId: deal.id,
				companyId: deal.companyId,
				createdById,
			});
			if (row.created) created += 1;
		}

		// The re-check is the one that is pure recurring revenue, and the easiest
		// to lose — it falls due six months after everyone has moved on.
		const recheck = await this.ensure({
			kind: "RECHECK_DUE",
			title: `${RECHECK_MONTHS}-month re-check — ${deal.name}`,
			body: `Contractual ${RECHECK_MONTHS}-month re-check. Reach out ~4 weeks before it falls due.`,
			dueAt: this.addMonths(from, RECHECK_MONTHS),
			dealId: deal.id,
			companyId: deal.companyId,
			createdById,
		});
		if (recheck.created) created += 1;

		return { created, dealId };
	}

	/**
	 * A trial expiry does not complete — it lapses. The obligation exists so the
	 * lapse is visible before it happens, not after.
	 */
	async spawnForTrial(input: {
		companyId: string;
		dealId?: string;
		provisionedAt: Date;
		lengthDays: number;
		seats: number;
		createdById: string;
	}) {
		const expiry = this.addDays(input.provisionedAt, input.lengthDays);
		const company = await this.db.company.findUnique({ where: { id: input.companyId } });
		return this.ensure({
			kind: "TRIAL_EXPIRY",
			title: `Trial expires — ${company?.name ?? input.companyId}`,
			body: `${input.lengthDays}-day trial, ${input.seats} seat(s), provisioned ${input.provisionedAt.toISOString().slice(0, 10)}. It lapses on ${expiry.toISOString().slice(0, 10)} whether or not anyone acts.`,
			dueAt: expiry,
			dealId: input.dealId,
			companyId: input.companyId,
			createdById: input.createdById,
		});
	}

	/** Everything due or overdue, soonest first — the one list worth pushing. */
	async due(withinDays = 30) {
		const horizon = this.addDays(new Date(), withinDays);
		const rows = await this.db.activity.findMany({
			where: { type: "TASK", completedAt: null, dueAt: { lte: horizon } },
			orderBy: { dueAt: "asc" },
			include: { deal: { select: { name: true, stage: true } }, company: { select: { name: true } } },
		});
		return rows.filter((r) => {
			const meta = r.meta as { obligationKind?: string } | null;
			return Boolean(meta?.obligationKind);
		});
	}
}
