import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ActivityType, db } from "@crm/db";
import { ActivitiesService } from "../src/activities/activities.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ObligationsService } from "../src/obligations/obligations.service";

const suffix = process.env.TEST_RUN_ID ?? "obligation-lifecycle-spec";
const userId = `obligation-user-${suffix}`;
const domain = `obligation-${suffix}.test`;
const activities = new ActivitiesService(
	db,
	new ActivityStampService(db),
	new ObligationsService(db),
);
let companyId: string;

async function clean() {
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.company.deleteMany({ where: { domain } });
	await db.user.deleteMany({ where: { id: userId } });
}

async function successorsOf(id: string) {
	return db.activity.findMany({
		where: { type: "TASK", meta: { path: ["spawnedFrom"], equals: id } },
	});
}

async function createTask(kind: string, key: string) {
	return db.activity.create({
		data: {
			type: ActivityType.TASK,
			subject: `${kind} task`,
			dueAt: new Date(Date.now() - 86_400_000),
			occurredAt: new Date(),
			companyId,
			createdById: userId,
			meta: { obligationKind: kind, obligationKey: key },
		},
		select: { id: true },
	});
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Obligation Owner", email: `owner@${domain}` },
	});
	const company = await db.company.create({
		data: { name: "Obligation Company", domain },
		select: { id: true },
	});
	companyId = company.id;
});

afterAll(clean);

describe("completing an obligation task", () => {
	it("spawns the next re-check and removes it when re-opened", async () => {
		const recheck = await createTask("RECHECK_DUE", `recheck-${suffix}`);

		const done = await activities.complete(recheck.id, true);
		expect(done.completedAt).not.toBeNull();

		const spawned = await successorsOf(recheck.id);
		expect(spawned).toHaveLength(1);
		expect(spawned[0]?.completedAt).toBeNull();
		expect(spawned[0]?.dueAt?.getTime()).toBeGreaterThan(Date.now());

		await activities.complete(recheck.id, false);
		expect(await successorsOf(recheck.id)).toHaveLength(0);
	});

	it("spawns nothing for a deliverable", async () => {
		const deliverable = await createTask(
			"DELIVERABLE_DUE",
			`deliverable-${suffix}`,
		);

		await activities.complete(deliverable.id, true);
		expect(await successorsOf(deliverable.id)).toHaveLength(0);
	});
});
