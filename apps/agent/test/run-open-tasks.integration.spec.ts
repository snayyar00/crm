import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, type Prisma } from "@crm/db";
import { listRunOpenTasks } from "../agent/lib/run-runtime";

const suffix = crypto.randomUUID();
const userId = `open-tasks-user-${suffix}`;
const HOUR = 60 * 60 * 1000;

const agentIds: string[] = [];
const companyIds: string[] = [];
const contactIds: string[] = [];
const dealIds: string[] = [];

let scopedCompanyId = "";
let otherCompanyId = "";
let dealId = "";
let contactId = "";
let workspaceVersionId = "";
let selectedVersionId = "";

async function createVersion(
	name: string,
	dataScope: Prisma.InputJsonObject,
): Promise<string> {
	const agent = await db.agentDefinition.create({
		data: { name, status: "LIVE", createdById: userId },
		select: { id: true },
	});
	agentIds.push(agent.id);
	const version = await db.agentVersion.create({
		data: {
			agentId: agent.id,
			number: 1,
			status: "DEPLOYED",
			instructions: "List tasks.",
			manifest: {
				triggers: [
					{
						type: "MANUAL",
						name: "Manual run",
						summary: "Run on demand in tests",
						config: {},
					},
				],
				dataScope,
				actions: [
					{
						type: "run.summary",
						provider: "crm",
						summary: "Summarize the run",
					},
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
	return version.id;
}

async function createRun(versionId: string) {
	const version = await db.agentVersion.findUniqueOrThrow({
		where: { id: versionId },
		select: { agentId: true },
	});
	const run = await db.agentRun.create({
		data: {
			agentId: version.agentId,
			versionId,
			triggerType: "MANUAL",
			status: "RUNNING",
			startedAt: new Date(),
			idempotencyKey: `open-tasks-run-${crypto.randomUUID()}`,
			correlationId: crypto.randomUUID(),
			events: { create: { sequence: 0, type: "run.queued", data: {} } },
		},
		select: { id: true },
	});
	return run.id;
}

async function createTask(
	subject: string,
	links: { companyId?: string; dealId?: string; contactId?: string },
	dueAt: Date | null,
	completedAt: Date | null = null,
) {
	await db.activity.create({
		data: {
			type: "TASK",
			subject: `${subject} ${suffix}`,
			dueAt,
			completedAt,
			createdById: userId,
			...links,
		},
	});
}

function subjects(tasks: { subject: string | null }[]) {
	return tasks.map((task) => task.subject?.replace(` ${suffix}`, ""));
}

async function ownTasks(versionId: string, overdueOnly: boolean) {
	const result = await listRunOpenTasks(await createRun(versionId), {
		overdueOnly,
		limit: 100,
	});
	return result.tasks.filter((task) => task.subject?.endsWith(suffix));
}

beforeAll(async () => {
	const now = Date.now();
	await db.user.create({
		data: { id: userId, name: "Task Owner", email: `${userId}@example.test` },
	});
	const scoped = await db.company.create({
		data: { name: "Scoped Co", domain: `scoped-${suffix}.example.test` },
		select: { id: true },
	});
	const other = await db.company.create({
		data: { name: "Other Co", domain: `other-${suffix}.example.test` },
		select: { id: true },
	});
	scopedCompanyId = scoped.id;
	otherCompanyId = other.id;
	companyIds.push(scoped.id, other.id);
	const contact = await db.contact.create({
		data: {
			firstName: "Tess",
			lastName: "Task",
			email: `tess-${suffix}@example.test`,
			companyId: scoped.id,
		},
		select: { id: true },
	});
	contactId = contact.id;
	contactIds.push(contact.id);
	const deal = await db.deal.create({
		data: {
			name: "Closed deal",
			companyId: scoped.id,
			ownerId: userId,
			stage: "CLOSED_WON",
		},
		select: { id: true },
	});
	dealId = deal.id;
	dealIds.push(deal.id);

	await createTask(
		"company overdue",
		{ companyId: scoped.id },
		new Date(now - 48 * HOUR),
	);
	await createTask(
		"deal overdue",
		{ companyId: scoped.id, dealId: deal.id },
		new Date(now - 24 * HOUR),
	);
	await createTask(
		"contact future",
		{ contactId: contact.id },
		new Date(now + 24 * HOUR),
	);
	await createTask("no date", { companyId: scoped.id }, null);
	await createTask(
		"already done",
		{ companyId: scoped.id },
		new Date(now - 48 * HOUR),
		new Date(now - 24 * HOUR),
	);
	await createTask(
		"other company overdue",
		{ companyId: other.id },
		new Date(now - 72 * HOUR),
	);
	await db.activity.create({
		data: {
			type: "NOTE",
			subject: `a note ${suffix}`,
			dueAt: new Date(now - 48 * HOUR),
			companyId: scoped.id,
			createdById: userId,
		},
	});

	workspaceVersionId = await createVersion("Open tasks workspace", {
		mode: "WORKSPACE",
		summary: "All workspace records",
		resources: [],
	});
	selectedVersionId = await createVersion("Open tasks selected", {
		mode: "SELECTED",
		summary: "One selected company",
		resources: [{ kind: "company", id: scoped.id, label: "Scoped Co" }],
	});
});

afterAll(async () => {
	await db.activity.deleteMany({ where: { createdById: userId } });
	for (const agentId of agentIds) {
		await db.agentRunEvent.deleteMany({ where: { run: { agentId } } });
		await db.agentRun.deleteMany({ where: { agentId } });
		await db.agentRecordState.deleteMany({ where: { agentId } });
		await db.agentVersion.deleteMany({ where: { agentId } });
		await db.agentDefinition.deleteMany({ where: { id: agentId } });
	}
	await db.deal.deleteMany({ where: { id: { in: dealIds } } });
	await db.contact.deleteMany({ where: { id: { in: contactIds } } });
	await db.company.deleteMany({ where: { id: { in: companyIds } } });
	await db.user.deleteMany({ where: { id: userId } });
});

describe("listRunOpenTasks", () => {
	it("finds an overdue task that sits on a company with no deal", async () => {
		const tasks = await ownTasks(workspaceVersionId, true);

		expect(subjects(tasks)).toEqual([
			"other company overdue",
			"company overdue",
			"deal overdue",
		]);
		expect(tasks.every((task) => task.overdue)).toBe(true);
		const companyTask = tasks[1];
		expect(companyTask?.company).toEqual({
			id: scopedCompanyId,
			name: "Scoped Co",
		});
		expect(companyTask?.deal).toBeNull();
		expect(companyTask?.owner).toEqual({ id: userId, name: "Task Owner" });
	});

	it("lists open tasks soonest first, undated last, and skips done tasks and notes", async () => {
		const tasks = await ownTasks(workspaceVersionId, false);

		expect(subjects(tasks)).toEqual([
			"other company overdue",
			"company overdue",
			"deal overdue",
			"contact future",
			"no date",
		]);
		expect(tasks.map((task) => task.overdue)).toEqual([
			true,
			true,
			true,
			false,
			false,
		]);
		expect(tasks[2]?.deal).toEqual({
			id: dealId,
			name: "Closed deal",
			stage: "CLOSED_WON",
		});
		expect(tasks[3]?.contact).toEqual({ id: contactId, name: "Tess Task" });
		expect(tasks[4]?.dueAt).toBeNull();
	});

	it("keeps a selected-scope run inside its approved records", async () => {
		const tasks = await ownTasks(selectedVersionId, true);

		expect(subjects(tasks)).toEqual(["company overdue", "deal overdue"]);
		expect(tasks.some((task) => task.company?.id === otherCompanyId)).toBe(
			false,
		);
	});

	it("reports the full total when the limit cuts the page", async () => {
		const result = await listRunOpenTasks(await createRun(selectedVersionId), {
			overdueOnly: false,
			limit: 1,
		});

		expect(result.tasks).toHaveLength(1);
		expect(result.total).toBe(3);
	});

	it("does not mark any record reviewed", async () => {
		const runId = await createRun(workspaceVersionId);
		const version = await db.agentVersion.findUniqueOrThrow({
			where: { id: workspaceVersionId },
			select: { agentId: true },
		});

		await listRunOpenTasks(runId, { overdueOnly: true, limit: 10 });

		expect(
			await db.agentRecordState.count({
				where: { agentId: version.agentId },
			}),
		).toBe(0);
	});
});
