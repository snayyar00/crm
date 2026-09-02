import { type AgentRecordStatus, db, type Prisma } from "@crm/db";

export type RecordKind = "contact" | "company" | "deal";

export type RecordScope = {
	mode: "SELECTED" | "WORKSPACE";
	resources: { kind: string; id: string }[];
};

export type DueRecord = {
	kind: RecordKind;
	id: string;
	label: string;
	changedAt: string;
	dueBecause: "never reviewed" | "changed since last review" | "follow-up due";
	state: {
		status: AgentRecordStatus;
		reason: string | null;
		nextDueAt: string | null;
		lastReviewedAt: string | null;
	} | null;
};

type Candidate = {
	kind: RecordKind;
	id: string;
	label: string;
	changedAt: Date;
};

const ALL_KINDS: RecordKind[] = ["contact", "company", "deal"];
const DEFAULT_LIMIT = 25;
const DUE_ORDER: Record<DueRecord["dueBecause"], number> = {
	"follow-up due": 0,
	"changed since last review": 1,
	"never reviewed": 2,
};

/**
 * When the record last moved in a way the agent should see: an edit, an
 * activity, or a new email on it. This is the whole "has anything changed
 * since I last looked" test, so it stays in SQL and never loads bodies.
 */
async function candidatesOf(kind: RecordKind): Promise<Candidate[]> {
	if (kind === "contact") {
		const rows = await db.$queryRaw<
			{ id: string; label: string; changedAt: Date }[]
		>`
			SELECT c.id,
				COALESCE(NULLIF(TRIM(CONCAT(c."firstName", ' ', COALESCE(c."lastName", ''))), ''), c.email) AS label,
				GREATEST(
					c."updatedAt",
					COALESCE(c."lastActivityAt", c."updatedAt"),
					COALESCE((SELECT MAX(t."lastMessageAt") FROM "emailThread" t WHERE t."contactId" = c.id), c."updatedAt")
				) AS "changedAt"
			FROM "contact" c
			WHERE c.email IS NOT NULL
		`;
		return rows.map((row) => ({ kind, ...row }));
	}
	if (kind === "company") {
		const rows = await db.$queryRaw<
			{ id: string; label: string; changedAt: Date }[]
		>`
			SELECT c.id, c.name AS label,
				GREATEST(
					c."updatedAt",
					COALESCE(c."lastActivityAt", c."updatedAt"),
					COALESCE((SELECT MAX(t."lastMessageAt") FROM "emailThread" t WHERE t."companyId" = c.id), c."updatedAt")
				) AS "changedAt"
			FROM "company" c
		`;
		return rows.map((row) => ({ kind, ...row }));
	}
	const rows = await db.$queryRaw<
		{ id: string; label: string; changedAt: Date }[]
	>`
		SELECT d.id, d.name AS label,
			GREATEST(d."updatedAt", COALESCE(d."lastActivityAt", d."updatedAt")) AS "changedAt"
		FROM "deal" d
	`;
	return rows.map((row) => ({ kind, ...row }));
}

export async function recordChangedAt(
	kind: RecordKind,
	id: string,
): Promise<Date | null> {
	const rows = await candidatesOf(kind);
	return rows.find((row) => row.id === id)?.changedAt ?? null;
}

export function dueBecause(
	state: { lastReviewedAt: Date | null; nextDueAt: Date | null } | null,
	changedAt: Date,
	now: Date,
): DueRecord["dueBecause"] | null {
	if (!state || !state.lastReviewedAt) return "never reviewed";
	if (changedAt > state.lastReviewedAt) return "changed since last review";
	if (state.nextDueAt && state.nextDueAt <= now) return "follow-up due";
	return null;
}

export async function listDueRecords(
	agentId: string,
	scope: RecordScope,
	options: { kinds?: RecordKind[]; limit?: number; now?: Date } = {},
) {
	const now = options.now ?? new Date();
	const kinds = options.kinds?.length ? options.kinds : ALL_KINDS;
	const limit = options.limit ?? DEFAULT_LIMIT;

	const allowed =
		scope.mode === "WORKSPACE"
			? null
			: new Set(scope.resources.map((r) => `${r.kind}:${r.id}`));
	const candidates = (
		await Promise.all(kinds.map((kind) => candidatesOf(kind)))
	)
		.flat()
		.filter((row) => !allowed || allowed.has(`${row.kind}:${row.id}`));

	const states = await db.agentRecordState.findMany({
		where: { agentId, targetType: { in: kinds } },
		select: {
			targetType: true,
			targetId: true,
			status: true,
			reason: true,
			nextDueAt: true,
			lastReviewedAt: true,
		},
	});
	const stateOf = new Map(
		states.map((row) => [`${row.targetType}:${row.targetId}`, row]),
	);

	const due: DueRecord[] = [];
	for (const row of candidates) {
		const state = stateOf.get(`${row.kind}:${row.id}`) ?? null;
		const because = dueBecause(state, row.changedAt, now);
		if (!because) continue;
		due.push({
			kind: row.kind,
			id: row.id,
			label: row.label,
			changedAt: row.changedAt.toISOString(),
			dueBecause: because,
			state: state
				? {
						status: state.status,
						reason: state.reason,
						nextDueAt: state.nextDueAt?.toISOString() ?? null,
						lastReviewedAt: state.lastReviewedAt?.toISOString() ?? null,
					}
				: null,
		});
	}
	due.sort(
		(a, b) =>
			DUE_ORDER[a.dueBecause] - DUE_ORDER[b.dueBecause] ||
			b.changedAt.localeCompare(a.changedAt),
	);

	return {
		now: now.toISOString(),
		inScope: candidates.length,
		due: due.slice(0, limit),
		dueTotal: due.length,
		skipped: candidates.length - due.length,
	};
}

/** Reading a record is reviewing it. Status and follow-up date stay as they were. */
export async function markReviewed(
	agentId: string,
	runId: string,
	kind: RecordKind,
	id: string,
) {
	const now = new Date();
	const changedAt = await recordChangedAt(kind, id);
	const fingerprint = changedAt?.toISOString() ?? null;
	return db.agentRecordState.upsert({
		where: {
			agentId_targetType_targetId: {
				agentId,
				targetType: kind,
				targetId: id,
			},
		},
		create: {
			agentId,
			targetType: kind,
			targetId: id,
			lastReviewedAt: now,
			lastRunId: runId,
			fingerprint,
		},
		update: { lastReviewedAt: now, lastRunId: runId, fingerprint },
		select: {
			status: true,
			reason: true,
			nextDueAt: true,
			lastReviewedAt: true,
		},
	});
}

export async function setRecordState(
	agentId: string,
	runId: string,
	input: {
		kind: RecordKind;
		id: string;
		status: AgentRecordStatus;
		reason?: string | null;
		nextDueAt?: Date | null;
	},
) {
	const now = new Date();
	const changedAt = await recordChangedAt(input.kind, input.id);
	const data = {
		status: input.status,
		reason: input.reason?.trim() || null,
		nextDueAt: input.nextDueAt ?? null,
		lastReviewedAt: now,
		lastRunId: runId,
		fingerprint: changedAt?.toISOString() ?? null,
	};
	return db.agentRecordState.upsert({
		where: {
			agentId_targetType_targetId: {
				agentId,
				targetType: input.kind,
				targetId: input.id,
			},
		},
		create: { agentId, targetType: input.kind, targetId: input.id, ...data },
		update: data,
		select: {
			targetType: true,
			targetId: true,
			status: true,
			reason: true,
			nextDueAt: true,
			lastReviewedAt: true,
		},
	});
}

/**
 * The agent's own notes bump lastActivityAt on the records it touched, which
 * would make them look "changed" on the next run. Stamp everything this run
 * reviewed as reviewed at the moment it finishes.
 */
export async function restampRunReviews(
	agentId: string,
	runId: string,
	tx: Prisma.TransactionClient | typeof db = db,
) {
	return tx.agentRecordState.updateMany({
		where: { agentId, lastRunId: runId },
		data: { lastReviewedAt: new Date() },
	});
}
