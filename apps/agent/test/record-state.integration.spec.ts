import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import {
	createRunActivity,
	listRunDueRecords,
	readRunRecord,
	setRunRecordState,
	stageRunResult,
} from "../agent/lib/run-runtime";

const suffix = crypto.randomUUID();
const userId = `record-state-user-${suffix}`;
let agentId = "";
let versionId = "";
let companyId = "";
let contactId = "";

async function createRun() {
	return db.agentRun.create({
		data: {
			agentId,
			versionId,
			triggerType: "MANUAL",
			status: "RUNNING",
			startedAt: new Date(),
			idempotencyKey: `record-state-run-${crypto.randomUUID()}`,
			correlationId: crypto.randomUUID(),
			events: { create: { sequence: 0, type: "run.queued", data: {} } },
		},
		select: { id: true },
	});
}

async function dueIds(runId: string) {
	const list = await listRunDueRecords(runId);
	return new Map(list.due.map((row) => [`${row.kind}:${row.id}`, row]));
}

beforeAll(async () => {
	await db.user.create({
		data: { id: userId, name: "Record State", email: `${userId}@example.test` },
	});
	const company = await db.company.create({
		data: { name: "Record State Co", domain: `record-${suffix}.example.test` },
		select: { id: true },
	});
	companyId = company.id;
	const contact = await db.contact.create({
		data: {
			firstName: "Stacey",
			lastName: "State",
			email: `stacey-${suffix}@example.test`,
			companyId,
		},
		select: { id: true },
	});
	contactId = contact.id;
	const agent = await db.agentDefinition.create({
		data: { name: "Record state", status: "LIVE", createdById: userId },
		select: { id: true },
	});
	agentId = agent.id;
	const version = await db.agentVersion.create({
		data: {
			agentId,
			number: 1,
			status: "DEPLOYED",
			instructions: "Work only on due records.",
			manifest: {
				dataScope: {
					mode: "SELECTED",
					resources: [
						{ kind: "company", id: companyId, label: "Record State Co" },
						{ kind: "contact", id: contactId, label: "Stacey State" },
					],
				},
				actions: [
					{ type: "crm.activity.create", activityTypes: ["NOTE"] },
					{ type: "run.summary" },
				],
			},
			modelId: "test/model",
			sandboxPolicy: {},
			createdById: userId,
			approvedAt: new Date(),
			deployedAt: new Date(),
		},
		select: { id: true },
	});
	versionId = version.id;
	await db.agentDefinition.update({
		where: { id: agentId },
		data: { currentVersionId: versionId },
	});
});

afterAll(async () => {
	if (agentId) {
		await db.agentRunEvent.deleteMany({ where: { run: { agentId } } });
		await db.agentAction.deleteMany({ where: { agentId } });
		await db.activity.deleteMany({
			where: { meta: { path: ["agentId"], equals: agentId } },
		});
		await db.agentAuditEvent.deleteMany({ where: { agentId } });
		await db.agentRun.deleteMany({ where: { agentId } });
		await db.agentRecordState.deleteMany({ where: { agentId } });
		await db.agentDefinition.update({
			where: { id: agentId },
			data: { currentVersionId: null },
		});
		await db.agentVersion.deleteMany({ where: { agentId } });
		await db.agentDefinition.deleteMany({ where: { id: agentId } });
	}
	await db.contact.deleteMany({ where: { id: contactId } });
	await db.company.deleteMany({ where: { id: companyId } });
	await db.user.deleteMany({ where: { id: userId } });
});

describe("agent record state", () => {
	it("lists a record once, then only when it changes or its follow-up is due", async () => {
		const run = await createRun();
		const key = `contact:${contactId}`;

		const fresh = await dueIds(run.id);
		expect(fresh.get(key)?.dueBecause).toBe("never reviewed");
		expect(fresh.get(`company:${companyId}`)?.dueBecause).toBe(
			"never reviewed",
		);
		const list = await listRunDueRecords(run.id);
		expect(list.inScope).toBe(2);

		await readRunRecord(run.id, { kind: "contact", id: contactId });
		expect((await dueIds(run.id)).has(key)).toBe(false);

		await new Promise((resolve) => setTimeout(resolve, 5));
		await db.contact.update({
			where: { id: contactId },
			data: { title: "Head of Digital" },
		});
		expect((await dueIds(run.id)).get(key)?.dueBecause).toBe(
			"changed since last review",
		);

		const parked = await setRunRecordState(run.id, {
			kind: "contact",
			id: contactId,
			status: "PARKED",
			reason: "Recite Me renewal lands mid October",
			nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
		});
		expect(parked).toMatchObject({ label: "Stacey State", status: "PARKED" });
		expect((await dueIds(run.id)).has(key)).toBe(false);

		await setRunRecordState(run.id, {
			kind: "contact",
			id: contactId,
			status: "PARKED",
			reason: "look again",
			nextDueAt: new Date(Date.now() - 1_000).toISOString(),
		});
		const again = (await dueIds(run.id)).get(key);
		expect(again?.dueBecause).toBe("follow-up due");
		expect(again?.state).toMatchObject({
			status: "PARKED",
			reason: "look again",
		});

		await setRunRecordState(run.id, {
			kind: "contact",
			id: contactId,
			status: "DONE",
		});
		expect((await dueIds(run.id)).has(key)).toBe(false);

		let activeError: Error | null = null;
		try {
			await setRunRecordState(run.id, {
				kind: "contact",
				id: contactId,
				status: "ACTIVE",
			});
		} catch (error) {
			activeError = error as Error;
		}
		expect(activeError?.message).toContain("needs nextDueAt");
	});

	it("does not wake a record because of the agent's own note", async () => {
		const run = await createRun();
		const key = `company:${companyId}`;

		await readRunRecord(run.id, { kind: "company", id: companyId });
		expect((await dueIds(run.id)).has(key)).toBe(false);

		await new Promise((resolve) => setTimeout(resolve, 5));
		await createRunActivity(run.id, "own-note", {
			type: "NOTE",
			targetKind: "company",
			targetId: companyId,
			subject: "Draft: Audit day-0",
			body: "TO: stacey",
		});
		expect((await dueIds(run.id)).get(key)?.dueBecause).toBe(
			"changed since last review",
		);

		await stageRunResult(run.id, { summary: "drafted", result: { n: 1 } });
		expect((await dueIds(run.id)).has(key)).toBe(false);
	});
});
