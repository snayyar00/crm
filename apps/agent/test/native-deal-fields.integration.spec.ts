import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { writeField } from "../agent/lib/fields";

const suffix = process.env.TEST_RUN_ID ?? "native-deal-spec";
const domain = `native-deal.${suffix}.example.test`;

let dealId: string;
let companyId: string;

beforeAll(async () => {
	const owner = await db.user.findFirst({ select: { id: true } });
	if (!owner) throw new Error("Test database has no user row.");

	await db.company.deleteMany({ where: { domain } });
	const company = await db.company.create({
		data: { name: "Native Deal Spec Co", domain },
		select: { id: true },
	});
	companyId = company.id;

	const deal = await db.deal.create({
		data: {
			name: "Native field spec deal",
			companyId,
			ownerId: owner.id,
			amount: 0,
		},
		select: { id: true },
	});
	dealId = deal.id;
});

afterAll(async () => {
	await db.company.deleteMany({ where: { id: companyId } });
});

describe("writeField on native deal fields", () => {
	it("writes amount through to deal.amount", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "amount",
			value: 2500,
		});

		expect(result.written).toBe(true);

		const deal = await db.deal.findUnique({
			where: { id: dealId },
			select: { amount: true },
		});
		expect(deal?.amount?.toNumber()).toBe(2500);
	});

	it("clears amount with null", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "amount",
			value: null,
		});
		expect(result.written).toBe(true);

		const deal = await db.deal.findUnique({
			where: { id: dealId },
			select: { amount: true, baseAmount: true },
		});
		expect(deal?.amount).toBeNull();
		expect(deal?.baseAmount).toBeNull();
	});

	it("refuses a negative amount", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "amount",
			value: -5,
		});
		expect(result.written).toBe(false);
	});

	it("normalizes the currency code", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "currency",
			value: "eur",
		});
		expect(result.written).toBe(true);

		const deal = await db.deal.findUnique({
			where: { id: dealId },
			select: { currency: true },
		});
		expect(deal?.currency).toBe("EUR");
	});

	it("refuses a currency that is not a code", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "currency",
			value: "monopoly money",
		});
		expect(result.written).toBe(false);
	});

	it("writes expected_close_date as a date", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "expected_close_date",
			value: "2026-09-25",
		});
		expect(result.written).toBe(true);

		const deal = await db.deal.findUnique({
			where: { id: dealId },
			select: { expectedCloseDate: true },
		});
		expect(deal?.expectedCloseDate?.toISOString().slice(0, 10)).toBe(
			"2026-09-25",
		);
	});

	it("refuses a malformed date", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "expected_close_date",
			value: "soon",
		});
		expect(result.written).toBe(false);
	});

	it("still refuses unknown keys", async () => {
		const result = await writeField({
			entity: "DEAL",
			recordId: dealId,
			key: "made_up_key",
			value: 1,
		});
		expect(result.written).toBe(false);
	});

	it("does not treat native deal keys as native on companies", async () => {
		const result = await writeField({
			entity: "COMPANY",
			recordId: companyId,
			key: "amount",
			value: 10,
		});
		expect(result.written).toBe(false);
	});
});
