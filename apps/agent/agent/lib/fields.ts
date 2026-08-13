import { db, Prisma } from "@crm/db";
import { isCurrencyCode, normalizeCurrency } from "@crm/db/currency";
import type { FieldEntity, FieldType } from "@crm/db/enums";
import {
	attachValues,
	type FieldDefinitionWithOptions,
	FieldValueError,
	fieldKeyFromLabel,
	type RecordField,
	recordColumn,
	type SerializedField,
	serializeField,
	usesOptions,
	writeValues,
} from "@crm/db/fields";
import { convertToBase } from "@crm/db/fx";
import { readReportingCurrency } from "@crm/db/settings";

const WITH_OPTIONS = { options: { orderBy: { position: "asc" } } } as const;

export type { FieldEntity, FieldType, RecordField, SerializedField };

async function definitionsFor(
	entity: FieldEntity,
): Promise<FieldDefinitionWithOptions[]> {
	return db.fieldDefinition.findMany({
		where: { entity, archivedAt: null },
		include: WITH_OPTIONS,
		orderBy: { position: "asc" },
	});
}

export async function listFields(
	entity: FieldEntity,
): Promise<SerializedField[]> {
	const definitions = await definitionsFor(entity);
	return definitions.map(serializeField);
}

export async function readFields(
	entity: FieldEntity,
	recordId: string,
): Promise<RecordField[]> {
	const column = recordColumn(entity);

	const [definitions, rows] = await Promise.all([
		definitionsFor(entity),
		db.fieldValue.findMany({ where: { [column]: recordId } }),
	]);

	return attachValues(definitions, rows);
}

export type WriteResult =
	| { written: true; key: string; value: unknown }
	| { written: false; reason: string };

const MAX_DEAL_AMOUNT = 999_999_999_999.99;

export const NATIVE_DEAL_FIELDS = [
	{
		key: "amount",
		label: "Amount",
		type: "NUMBER",
		brief:
			"What the customer pays, in units of the deal's currency. A number, 0 or more, or null to clear.",
	},
	{
		key: "currency",
		label: "Currency",
		type: "TEXT",
		brief: "Three-letter currency code, e.g. USD or EUR.",
	},
	{
		key: "expected_close_date",
		label: "Expected close",
		type: "DATE",
		brief: "When the deal is expected to close, YYYY-MM-DD, or null to clear.",
	},
] as const;

const NATIVE_DEAL_KEYS = new Set<string>(
	NATIVE_DEAL_FIELDS.map((field) => field.key),
);

async function writeNativeDealField(
	recordId: string,
	key: string,
	value: unknown,
): Promise<WriteResult> {
	const deal = await db.deal.findUnique({
		where: { id: recordId },
		select: { amount: true, currency: true },
	});

	if (!deal) {
		return { written: false, reason: `No deal with id ${recordId}.` };
	}

	if (key === "expected_close_date") {
		if (value === null) {
			await db.deal.update({
				where: { id: recordId },
				data: { expectedCloseDate: null },
			});
			return { written: true, key, value };
		}

		if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return {
				written: false,
				reason: "expected_close_date takes YYYY-MM-DD, or null to clear it.",
			};
		}

		const date = new Date(`${value}T00:00:00.000Z`);
		if (Number.isNaN(date.getTime())) {
			return { written: false, reason: `"${value}" is not a real date.` };
		}

		await db.deal.update({
			where: { id: recordId },
			data: { expectedCloseDate: date },
		});
		return { written: true, key, value };
	}

	let amount = deal.amount;
	let currency = normalizeCurrency(deal.currency);

	if (key === "amount") {
		if (value === null) {
			amount = null;
		} else if (
			typeof value === "number" &&
			Number.isFinite(value) &&
			value >= 0 &&
			value <= MAX_DEAL_AMOUNT
		) {
			amount = new Prisma.Decimal(value.toFixed(2));
		} else {
			return {
				written: false,
				reason:
					"amount takes a number of currency units, 0 or more, or null to clear it.",
			};
		}
	}

	if (key === "currency") {
		if (typeof value !== "string" || !isCurrencyCode(value)) {
			return {
				written: false,
				reason: `"${String(value)}" is not a supported currency code. Use one of the codes in Settings → Currencies, e.g. USD or EUR.`,
			};
		}
		currency = normalizeCurrency(value);
	}

	const converted = await convertToBase(
		db,
		amount,
		currency,
		await readReportingCurrency(db),
	);

	await db.deal.update({
		where: { id: recordId },
		data: {
			amount,
			currency,
			baseAmount: converted?.baseAmount ?? null,
			baseCurrency: converted?.baseCurrency ?? null,
			fxRate: converted?.fxRate ?? null,
			fxRateAt: converted?.fxRateAt ?? null,
		},
	});

	return { written: true, key, value };
}

export async function writeField(input: {
	entity: FieldEntity;
	recordId: string;
	key: string;
	value: unknown;
}): Promise<WriteResult> {
	const definitions = await definitionsFor(input.entity);
	const definition = definitions.find((entry) => entry.key === input.key);

	if (!definition) {
		if (input.entity === "DEAL" && NATIVE_DEAL_KEYS.has(input.key)) {
			return writeNativeDealField(input.recordId, input.key, input.value);
		}

		return {
			written: false,
			reason: `There is no field called "${input.key}" on ${input.entity.toLowerCase()}s. Call list_fields to see what exists.`,
		};
	}

	if (!definition.agentFilled) {
		return {
			written: false,
			reason: `"${input.key}" is marked manual only, so a rep keeps it by hand.`,
		};
	}

	try {
		await writeValues(db, input.entity, input.recordId, definitions, {
			[input.key]: input.value,
		});
	} catch (error) {
		if (error instanceof FieldValueError) {
			return { written: false, reason: error.message };
		}

		throw error;
	}

	return { written: true, key: input.key, value: input.value };
}

export async function createField(input: {
	entity: FieldEntity;
	label: string;
	type: FieldType;
	options?: string[];
	agentBrief?: string;
}): Promise<SerializedField | { created: false; reason: string }> {
	const key = fieldKeyFromLabel(input.label);

	if (!key) {
		return { created: false, reason: "That label does not make a usable key." };
	}

	const taken = await db.fieldDefinition.findUnique({
		where: { entity_key: { entity: input.entity, key } },
		select: { id: true },
	});

	if (taken) {
		return {
			created: false,
			reason: `There is already a field called "${key}" on ${input.entity.toLowerCase()}s.`,
		};
	}

	if (usesOptions(input.type) && (input.options ?? []).length === 0) {
		return { created: false, reason: "A select needs at least one option." };
	}

	const last = await db.fieldDefinition.findFirst({
		where: { entity: input.entity },
		orderBy: { position: "desc" },
		select: { position: true },
	});

	const definition = await db.fieldDefinition.create({
		data: {
			entity: input.entity,
			key,
			label: input.label,
			type: input.type,
			agentBrief: input.agentBrief ?? null,
			position: (last?.position ?? -1) + 1,
			options: usesOptions(input.type)
				? {
						create: (input.options ?? []).map((label, index) => ({
							label,
							position: index,
						})),
					}
				: undefined,
		},
		include: WITH_OPTIONS,
	});

	return serializeField(definition);
}

export async function updateFieldBrief(input: {
	entity: FieldEntity;
	key: string;
	agentBrief: string | null;
	agentFilled?: boolean;
}): Promise<SerializedField | { updated: false; reason: string }> {
	const existing = await db.fieldDefinition.findUnique({
		where: { entity_key: { entity: input.entity, key: input.key } },
		select: { id: true },
	});

	if (!existing) {
		return {
			updated: false,
			reason: `There is no field called "${input.key}".`,
		};
	}

	const definition = await db.fieldDefinition.update({
		where: { id: existing.id },
		data: { agentBrief: input.agentBrief, agentFilled: input.agentFilled },
		include: WITH_OPTIONS,
	});

	return serializeField(definition);
}

export async function archiveField(input: {
	entity: FieldEntity;
	key: string;
}): Promise<{ archived: boolean; reason?: string }> {
	const existing = await db.fieldDefinition.findUnique({
		where: { entity_key: { entity: input.entity, key: input.key } },
		select: { id: true },
	});

	if (!existing) {
		return {
			archived: false,
			reason: `There is no field called "${input.key}".`,
		};
	}

	await db.fieldDefinition.update({
		where: { id: existing.id },
		data: { archivedAt: new Date() },
	});

	return { archived: true };
}
