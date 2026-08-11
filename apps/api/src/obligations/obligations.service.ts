import type { Db } from "@crm/db";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * Dated obligations — the clocks an accessibility business runs on.
 *
 * NOT a new table. An obligation is an Activity of type TASK carrying
 * `meta.obligationKind`. The Commitment table was cut for the same reason: a
 * second obligation list is how the first one stopped being drained.
 *
 * What makes these different from an ordinary task is LIFECYCLE, and that lives
 * here rather than in the schema:
 *   - RECHECK_DUE regenerates: closing one spawns the next. IMPLEMENTED, in
 *     handleCompletionChange, hooked into the single place completedAt is written.
 *   - TRIAL_EXPIRY does not "complete" — it lapses, and lapsing is the alarm.
 *     Completing one is DISMISSAL: the nag stops, nothing is spawned. Refusing to
 *     let a one-person shop silence a nag would just train them around the tool.
 *   - VPAT_EXPIRY would supersede, but NOTHING SPAWNS ONE TODAY, so no lifecycle
 *     is written for it. Do not add rules for a kind with no rows.
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

/**
 * The five deliverables every audit engagement contractually includes.
 *
 * `slug` is the IDENTITY; `title` is only what a human reads. They must stay
 * separate because the title embeds the deal name, and a deal can be renamed —
 * keying identity on the title meant a rename plus a re-fire of the CLOSED_WON
 * hook produced five duplicate obligations. Never derive a slug from a title.
 */
const AUDIT_DELIVERABLES = [
	{ slug: "audit-report", title: "Audit report", offsetDays: 14 },
	{
		slug: "vpat",
		title: "VPAT / Accessibility Conformance Report",
		offsetDays: 21,
	},
	{ slug: "statement", title: "Accessibility statement", offsetDays: 21 },
	{ slug: "verification", title: "Remediation verification", offsetDays: 45 },
] as const;

/** Contractual re-check interval for audit engagements. */
const RECHECK_MONTHS = 6;

/**
 * How much RUNWAY each kind needs, in days — not how soon it is due.
 *
 * This lives in the DOMAIN service, not in the thing that emails you, because
 * two consumers now depend on it (the morning alarm and the calendar screen) and
 * a second copy would drift. A screen that disagreed with the alarm about what
 * is urgent would make both untrustworthy.
 *
 * The numbers are the time needed to ACT: a trial lapse is unrecoverable and
 * rescuing one means a conversation, a fix and a signature; an audit report you
 * can write in a few days.
 */
export const LEAD_DAYS: Record<ObligationKind, number> = {
	TRIAL_EXPIRY: 14,
	RECHECK_DUE: 14,
	VPAT_EXPIRY: 21,
	LEGAL_DEADLINE: 14,
	DELIVERABLE_DUE: 3,
};
/** An unknown kind gets the TIGHTEST window — a new kind should under-alarm
 *  until someone gives it a considered lead time, not spam. */
export const DEFAULT_LEAD_DAYS = 3;
export const MAX_LEAD_DAYS = Math.max(
	...Object.values(LEAD_DAYS),
	DEFAULT_LEAD_DAYS,
);

/** Kinds where missing the date destroys the thing itself. A late audit report
 *  is late; a lapsed trial is over. */
export const IRREVERSIBLE: ReadonlySet<string> = new Set<ObligationKind>([
	"TRIAL_EXPIRY",
	"LEGAL_DEADLINE",
]);

export function leadDaysFor(kind: string | undefined): number {
	if (!kind) return DEFAULT_LEAD_DAYS;
	return LEAD_DAYS[kind as ObligationKind] ?? DEFAULT_LEAD_DAYS;
}

export function daysUntil(d: Date | null, now = Date.now()): number {
	if (!d) return Number.POSITIVE_INFINITY;
	return Math.floor((d.getTime() - now) / 86_400_000);
}

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
	 * Idempotent by (kind, title, scope) — re-running a spawn never duplicates.
	 * This is called from a deal event that can fire more than once.
	 *
	 * SCOPE is the company when there is one, and only otherwise the deal. That
	 * asymmetry is the fix for a real duplicate: the old key was
	 * `{ type, subject, dealId: input.dealId ?? undefined }`, and in Prisma an
	 * `undefined` filter is OMITTED rather than matched against NULL. So recording
	 * a trial before its deal existed and again after it was linked produced TWO
	 * clocks for one trial — the second lookup filtered on `dealId: <id>`, matched
	 * nothing, and created a duplicate. Reproduced before fixing:
	 *
	 *     call 1 created: true | call 2 created: true
	 *     TRIAL_EXPIRY rows for one trial: 2
	 *        deal=null         due=2026-08-31  Trial expires — REPRO-CO
	 *        deal=repro-deal   due=2026-08-31  Trial expires — REPRO-CO
	 *
	 * Company-first is right because an obligation belongs to the ACCOUNT: a trial
	 * does not become a different trial when a deal is attached to it. Deals stay
	 * distinguishable anyway because every per-deal title embeds the deal name
	 * ("Audit report — Hook Proof — WCAG audit").
	 *
	 * `kind` is now actually part of the key. The old doc comment claimed it was
	 * and the query never used it.
	 */
	/**
	 * The stable identity of one obligation. Contains no human-readable text, so
	 * renaming a deal or rewording a title cannot mint a duplicate.
	 *
	 * Scope is stated by the CALLER, not inferred from which id happens to be
	 * present: a won-deal deliverable belongs to its DEAL (one company can hold
	 * two audit engagements), while a trial belongs to the ACCOUNT (attaching a
	 * deal later must not make it a different trial).
	 */
	private obligationKey(input: {
		kind: ObligationKind;
		slug: string;
		scope: "deal" | "company";
		dealId?: string;
		companyId?: string;
	}): string {
		const id = input.scope === "deal" ? input.dealId : input.companyId;
		return `${input.kind}:${input.slug}:${input.scope}_${id ?? "none"}`;
	}

	private async ensure(input: {
		kind: ObligationKind;
		slug: string;
		scope: "deal" | "company";
		title: string;
		body: string;
		dueAt: Date;
		dealId?: string;
		companyId?: string;
		createdById: string;
	}) {
		const key = this.obligationKey(input);
		const existing = await this.db.activity.findFirst({
			where: {
				type: "TASK",
				meta: { path: ["obligationKey"], equals: key },
				// OPEN clocks only. A completed obligation is a SATISFIED clock, and
				// letting it match would silently swallow the next one: a second trial
				// a year later carries the same key as the first, so it would find the
				// closed row, report created:false, and leave the new expiry with
				// nothing watching it. Invisible on a board that hides completed tasks.
				completedAt: null,
			},
			// findFirst with no order is nondeterministic and pre-key duplicates may
			// still exist. Oldest wins so the choice is at least stable.
			orderBy: { occurredAt: "asc" },
		});

		// The deal-alias guard that used to live here is gone on purpose: the key
		// itself now carries the scope, so a row belonging to another deal has a
		// different key and can no longer be returned as this spawn's.
		if (existing) {
			// A repeat call can know things the first did not: the deal this obligation
			// belongs to, or a new date because the trial was extended. Silently keeping
			// a stale dueAt is worse than duplicating — a duplicate is noise the founder
			// deletes, a stale clock fires on the wrong day and is believed.
			const attachDeal = input.dealId && !existing.dealId;
			const dateMoved = existing.dueAt?.getTime() !== input.dueAt.getTime();
			if (attachDeal || dateMoved) {
				const updated = await this.db.activity.update({
					where: { id: existing.id },
					data: {
						...(attachDeal ? { dealId: input.dealId } : {}),
						...(dateMoved ? { dueAt: input.dueAt, body: input.body } : {}),
					},
				});
				return { row: updated, created: false, updated: true };
			}
			return { row: existing, created: false, updated: false };
		}

		try {
			return {
				row: await this.create(input, key),
				created: true,
				updated: false,
			};
		} catch (err) {
			// P2002 = the partial unique index on meta->>'obligationKey' rejected us,
			// which means a concurrent spawn (cron vs a manual call) won the race
			// between our findFirst and this insert. That is the index doing its job;
			// re-read and report the row as found, not created.
			if ((err as { code?: string }).code !== "P2002") throw err;
			const raced = await this.db.activity.findFirst({
				where: {
					type: "TASK",
					meta: { path: ["obligationKey"], equals: key },
					completedAt: null,
				},
			});
			if (!raced) throw err;
			this.logger.log({
				message: "Obligation lost an insert race; reused the winner",
				key,
			});
			return { row: raced, created: false, updated: false };
		}
	}

	private async create(
		input: {
			kind: ObligationKind;
			title: string;
			body: string;
			dueAt: Date;
			dealId?: string;
			companyId?: string;
			createdById: string;
		},
		key: string,
	) {
		return this.db.activity.create({
			data: {
				type: "TASK",
				subject: input.title,
				body: input.body,
				dueAt: input.dueAt,
				occurredAt: new Date(),
				dealId: input.dealId,
				companyId: input.companyId,
				createdById: input.createdById,
				meta: {
					obligationKind: input.kind,
					obligationKey: key,
					spawnedBy: "obligations.service",
				},
			},
		});
	}

	/**
	 * A won audit deal carries five contractual obligations. They are identical
	 * every time, which is exactly why they are forgettable: Questback signed on
	 * 2026-07-14 and 23 days later none of them had been started.
	 */
	async spawnForWonDeal(dealId: string, createdById: string) {
		const deal = await this.db.deal.findUnique({ where: { id: dealId } });
		if (!deal) return { created: 0, reason: "no such deal" };

		// Only an AUDIT carries these. Winning a widget subscription carries no
		// audit report, no VPAT and no 6-month re-check, and spawning them anyway
		// was the state of this code until 2026-08-11: on the real book, 3 of the 4
		// won deals are not audits, so it would have produced 15 phantom
		// obligations against 5 true ones. The alarm is only useful while it is
		// believed, which makes a false positive strictly worse than a miss —
		// missing a checklist risks one late deliverable on a signed SOW the
		// founder wrote himself; a lying alarm loses every deal it protects.
		if (deal.engagementType !== "AUDIT") {
			return {
				created: 0,
				reason: `not an audit engagement (${deal.engagementType ?? "unset"})`,
			};
		}

		const from = deal.closedAt ?? deal.stageChangedAt ?? new Date();
		let created = 0;

		for (const d of AUDIT_DELIVERABLES) {
			const row = await this.ensure({
				kind: "DELIVERABLE_DUE",
				slug: d.slug,
				scope: "deal",
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
			slug: `recheck-${RECHECK_MONTHS}m`,
			scope: "deal",
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
		const company = await this.db.company.findUnique({
			where: { id: input.companyId },
		});
		return this.ensure({
			kind: "TRIAL_EXPIRY",
			slug: "trial",
			scope: "company",
			title: `Trial expires — ${company?.name ?? input.companyId}`,
			body: `${input.lengthDays}-day trial, ${input.seats} seat(s), provisioned ${input.provisionedAt.toISOString().slice(0, 10)}. It lapses on ${expiry.toISOString().slice(0, 10)} whether or not anyone acts.`,
			dueAt: expiry,
			dealId: input.dealId,
			companyId: input.companyId,
			createdById: input.createdById,
		});
	}

	/**
	 * React to a task's completion flag changing. Called from ActivitiesService
	 * INSIDE its transaction — obligations own the rules, activities own the write.
	 *
	 * It lives on the completion path rather than behind its own mutation because
	 * the generic `activities.complete` is what the UI already calls. A separate
	 * `obligations.close` would leave the generic door open and kind-blind, which
	 * is the bug being fixed: today the founder ticks off the 6-month re-check —
	 * "the one that is pure recurring revenue, and the easiest to lose" — and the
	 * next one never appears. Completing it correctly is what destroys it.
	 *
	 * The caller passes `wasCompleted` so this only fires on a real TRANSITION. A
	 * second click on an already-completed task must not re-date the successor.
	 */
	async handleCompletionChange(
		tx: Db,
		activityId: string,
		wasCompleted: boolean,
		nowCompleted: boolean,
	) {
		if (wasCompleted === nowCompleted) return { spawned: null, deleted: null };

		const row = await tx.activity.findUnique({ where: { id: activityId } });
		const meta = (row?.meta ?? null) as {
			obligationKind?: string;
			obligationKey?: string;
		} | null;
		if (!row || !meta?.obligationKind) return { spawned: null, deleted: null };

		if (nowCompleted) return this.spawnSuccessor(tx, row, meta);
		return this.unspawnSuccessor(tx, row);
	}

	/**
	 * Dated from the COMPLETION, not from the original due date. A re-check
	 * verifies the site's current state, so the next one is meaningful six months
	 * after the last ACTUAL check. Anchoring to the old due date would compress
	 * every cycle by however late the close was — and closing more than six months
	 * late would spawn a successor that is born overdue.
	 */
	private async spawnSuccessor(
		tx: Db,
		row: {
			id: string;
			subject: string | null;
			body: string | null;
			dealId: string | null;
			companyId: string | null;
			createdById: string;
		},
		meta: { obligationKind?: string; obligationKey?: string },
	) {
		if (meta.obligationKind !== "RECHECK_DUE")
			return { spawned: null, deleted: null };

		const dueAt = this.addMonths(new Date(), RECHECK_MONTHS);
		try {
			const next = await tx.activity.create({
				data: {
					type: "TASK",
					subject: row.subject,
					body: `Contractual ${RECHECK_MONTHS}-month re-check. Reach out ~4 weeks before it falls due.`,
					dueAt,
					occurredAt: new Date(),
					dealId: row.dealId,
					companyId: row.companyId,
					createdById: row.createdById,
					meta: {
						obligationKind: "RECHECK_DUE",
						obligationKey: meta.obligationKey,
						spawnedBy: "obligations.lifecycle",
						// The link that makes un-completing reversible.
						spawnedFrom: row.id,
					},
				},
			});
			return { spawned: next.id, deleted: null };
		} catch (err) {
			// P2002 = the partial unique index already has an OPEN row for this key,
			// so a successor exists. A concurrent double-click is a no-op, not a 500.
			if ((err as { code?: string }).code === "P2002")
				return { spawned: null, deleted: null };
			throw err;
		}
	}

	/**
	 * Re-opening a completed re-check must first remove the successor its closure
	 * created, or the partial unique index rejects the re-open with a raw P2002.
	 * Deleting inside the same transaction is what keeps that from surfacing.
	 */
	private async unspawnSuccessor(tx: Db, row: { id: string }) {
		const successor = await tx.activity.findFirst({
			where: { type: "TASK", meta: { path: ["spawnedFrom"], equals: row.id } },
		});
		if (!successor) return { spawned: null, deleted: null };
		if (successor.completedAt) {
			throw new BadRequestException(
				"The next re-check spawned by this one has already been actioned. Re-open that one instead.",
			);
		}
		await tx.activity.delete({ where: { id: successor.id } });
		return { spawned: null, deleted: successor.id };
	}

	/**
	 * Everything due or overdue inside the horizon, soonest first, ANNOTATED with
	 * the urgency the alarm uses.
	 *
	 * The annotation is computed here rather than by each caller so there is one
	 * definition of "urgent". `slack` is days of runway left: negative means the
	 * work should already have started. The screen shows rows with positive slack
	 * too — the alarm hides those on purpose, but a calendar that hid them would
	 * just be the alarm with extra steps.
	 */
	async due(withinDays = 30) {
		const horizon = this.addDays(new Date(), withinDays);
		const rows = await this.db.activity.findMany({
			where: { type: "TASK", completedAt: null, dueAt: { lte: horizon } },
			orderBy: { dueAt: "asc" },
			include: {
				deal: { select: { name: true, stage: true } },
				company: { select: { name: true } },
			},
		});
		const now = Date.now();
		return rows
			.map((r) => {
				const kind = (r.meta as { obligationKind?: string } | null)
					?.obligationKind;
				const days = daysUntil(r.dueAt, now);
				const lead = leadDaysFor(kind);
				return {
					...r,
					kind,
					daysUntilDue: days,
					leadDays: lead,
					slack: days - lead,
					irreversible: IRREVERSIBLE.has(kind ?? ""),
				};
			})
			.filter((r) => Boolean(r.kind));
	}
}
