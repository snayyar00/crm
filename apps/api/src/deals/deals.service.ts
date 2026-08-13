import {
	ActivityType,
	type Db,
	type DealStage,
	type Prisma,
	Prisma as PrismaNamespace,
} from "@crm/db";
import { normalizeCurrency } from "@crm/db/currency";
import {
	CLOSED_DEAL_STAGES,
	isClosedStage,
	LOSING_DEAL_STAGES,
	OPEN_DEAL_STAGES,
} from "@crm/db/deal-stage";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import {
	ActivityStampService,
	type StampTargets,
} from "../crm/activity-stamp.service";
import { type BulkResult, requireOwner, runBulk } from "../crm/bulk";
import {
	blankToNull,
	decimalFromCents,
	fromCents,
	toCents,
} from "../crm/values";
import { ConversionService } from "../currency/conversion.service";
import { InjectDatabase } from "../database/database.constants";
import { FieldsService } from "../fields/fields.service";
import { ObligationsService } from "../obligations/obligations.service";
import {
	countsByKey,
	FACET_ALL,
	FACET_UNASSIGNED,
	type ListResult,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import type {
	ClosingWindow,
	DealAttachContactInput,
	DealBulkOwnerInput,
	DealBulkStageInput,
	DealContactRoleInput,
	DealCreateInput,
	DealDetachContactInput,
	DealListInput,
	DealUpdateInput,
	SetStageInput,
} from "./deals.contracts";
import { CLOSING_WINDOWS } from "./deals.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const COMPANY_SELECT = {
	id: true,
	name: true,
	domain: true,
	iconUrl: true,
	iconDarkUrl: true,
	iconTone: true,
	logoUrl: true,
} as const;

const CONTACT_SELECT = {
	id: true,
	firstName: true,
	lastName: true,
	email: true,
	title: true,
	imageUrl: true,
} as const;

const LOSING = new Set<DealStage>(LOSING_DEAL_STAGES);

const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.DealOrderByWithRelationInput[]
> = {
	name: (dir) => [{ name: dir }],
	company: (dir) => [{ company: { name: dir } }, { name: "asc" }],
	stage: (dir) => [{ stage: dir }, { expectedCloseDate: "asc" }],
	amount: (dir) => [{ baseAmount: { sort: dir, nulls: "last" } }],
	expectedCloseDate: (dir) => [{ expectedCloseDate: dir }],
	createdAt: (dir) => [{ createdAt: dir }],
	owner: (dir) => [{ owner: { name: dir } }, { name: "asc" }],
	lastActivity: (dir) => [{ lastActivityAt: { sort: dir, nulls: "last" } }],
};

@Injectable()
export class DealsService {
	private readonly logger = new Logger(DealsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
		private readonly conversion: ConversionService,
		private readonly fields: FieldsService,
		private readonly obligations: ObligationsService,
	) {}

	async list(input: DealListInput) {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const openWhere = { ...where, stage: { in: [...OPEN_DEAL_STAGES] } };
		const base = await this.conversion.reportingCurrency();

		const [rows, total, facetCounts, openValue, unconverted] =
			await Promise.all([
				this.db.deal.findMany({
					where,
					skip,
					take,
					orderBy: resolveOrderBy(input, SORTABLE, [{ createdAt: "desc" }]),
					select: {
						id: true,
						name: true,
						stage: true,
						amount: true,
						currency: true,
						baseAmount: true,
						expectedCloseDate: true,
						closedAt: true,
						company: { select: COMPANY_SELECT },
						owner: { select: OWNER_SELECT },
						lastActivityAt: true,
						createdAt: true,
					},
				}),
				this.db.deal.count({ where }),
				this.facetCounts(input),
				this.db.deal.aggregate({
					where: { AND: [openWhere, this.conversion.countedWhere(base)] },
					_sum: { baseAmount: true },
				}),
				this.conversion.unconverted(openWhere),
			]);

		const tableFields = await this.fields.tableValuesFor(
			"DEAL",
			rows.map((row) => row.id),
		);

		return {
			rows: rows.map(
				({
					amount,
					baseAmount,
					expectedCloseDate,
					closedAt,
					lastActivityAt,
					createdAt,
					...row
				}) => ({
					...row,
					amountCents: toCents(amount),
					baseAmountCents: toCents(baseAmount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
					closedAt: closedAt?.toISOString() ?? null,
					lastActivityAt: lastActivityAt?.toISOString() ?? null,
					createdAt: createdAt.toISOString(),
					fields: tableFields.get(row.id) ?? {},
				}),
			),
			total,
			facetCounts,
			openValueCents: toCents(openValue._sum.baseAmount),
			reportingCurrency: base,
			unconverted,
		} satisfies ListResult<unknown> & {
			openValueCents: number | null;
			reportingCurrency: string;
			unconverted: { count: number; currencies: string[] };
		};
	}

	async byId(id: string) {
		const deal = await this.db.deal.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				description: true,
				stage: true,
				stageChangedAt: true,
				amount: true,
				currency: true,
				baseAmount: true,
				fxRate: true,
				fxRateAt: true,
				expectedCloseDate: true,
				closedAt: true,
				closedReason: true,
				createdAt: true,
				company: { select: { ...COMPANY_SELECT, industry: true } },
				owner: { select: OWNER_SELECT },
				contacts: {
					select: { role: true, contact: { select: CONTACT_SELECT } },
					orderBy: { contact: { firstName: "asc" } },
				},
			},
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${id}.`);
		}

		const { contacts, amount, baseAmount, fxRate, fxRateAt, ...rest } = deal;

		return {
			...rest,
			fields: await this.fields.valuesFor("DEAL", id),
			amountCents: toCents(amount),
			baseAmountCents: toCents(baseAmount),
			reportingCurrency: await this.conversion.reportingCurrency(),
			fxRate: fxRate?.toNumber() ?? null,
			fxRateAt: fxRateAt?.toISOString() ?? null,
			stageChangedAt: deal.stageChangedAt.toISOString(),
			expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
			closedAt: deal.closedAt?.toISOString() ?? null,
			createdAt: deal.createdAt.toISOString(),
			contacts: contacts.map(({ role, contact }) => ({ ...contact, role })),
		};
	}

	async create(input: DealCreateInput) {
		const stage = input.stage ?? "DEMO_BOOKED";
		const closed = isClosedStage(stage);
		const now = new Date();

		const currency = normalizeCurrency(
			input.currency ?? (await this.conversion.reportingCurrency()),
		);
		const fx = await this.conversion.dealFields(
			decimalFromCents(input.amountCents),
			currency,
		);

		try {
			const deal = await this.db.deal.create({
				data: {
					name: input.name.trim(),
					companyId: input.companyId,
					ownerId: input.ownerId,
					stage,
					stageChangedAt: now,
					closedAt: closed ? now : null,
					amount: fromCents(input.amountCents),
					currency,
					...fx,
					expectedCloseDate: parseDate(input.expectedCloseDate),
				},
				select: { id: true, name: true, companyId: true },
			});

			this.logger.log({ message: "Deal created", dealId: deal.id, stage });

			return deal;
		} catch (error) {
			throw this.translateRelations(error);
		}
	}

	async update(id: string, input: DealUpdateInput) {
		const data: Prisma.DealUpdateInput = {};

		if (input.name !== undefined) data.name = input.name.trim();
		if (input.description !== undefined) {
			data.description =
				input.description === null ? null : blankToNull(input.description);
		}
		if (input.companyId !== undefined) {
			data.company = { connect: { id: input.companyId } };
		}
		if (input.ownerId !== undefined) {
			data.owner = { connect: { id: input.ownerId } };
		}
		if (input.amountCents !== undefined) {
			data.amount = fromCents(input.amountCents);
		}
		if (input.currency !== undefined) {
			data.currency = normalizeCurrency(input.currency);
		}
		if (input.expectedCloseDate !== undefined) {
			data.expectedCloseDate = parseDate(input.expectedCloseDate);
		}
		if (input.workStartedAt !== undefined) {
			data.workStartedAt = parseDate(input.workStartedAt);
		}

		if (input.amountCents !== undefined || input.currency !== undefined) {
			const current = await this.db.deal.findUnique({
				where: { id },
				select: { amount: true, currency: true },
			});

			if (!current) {
				throw new NotFoundException(`No deal with id ${id}.`);
			}

			const amount =
				input.amountCents !== undefined
					? decimalFromCents(input.amountCents)
					: current.amount;
			const currency =
				input.currency !== undefined
					? normalizeCurrency(input.currency)
					: normalizeCurrency(current.currency);

			Object.assign(data, await this.conversion.dealFields(amount, currency));
		}

		try {
			const updated = await this.db.$transaction(async (tx) => {
				if (input.fields) {
					await this.fields.applyValues(tx, "DEAL", id, input.fields);
				}

				return tx.deal.update({
					where: { id },
					data,
					select: { id: true, name: true },
				});
			});

			// Recording when the work could actually start re-derives the contractual
			// deliverables from that date. Outside the transaction and swallowed on
			// failure, like the won-deal hook: the user's edit must stand even if the
			// follow-up cannot be written, and the spawn is idempotent so a missed
			// reconcile is recoverable by saving the field again.
			if (input.workStartedAt !== undefined) {
				try {
					const spawned = await this.obligations.spawnForWonDeal(id, "system");
					this.logger.log({
						message: "Work start recorded; obligations re-derived",
						dealId: id,
						workStartedAt: input.workStartedAt,
						spawned,
					});
				} catch (err) {
					this.logger.error({
						message:
							"Could not re-derive obligations after a work-start change",
						dealId: id,
						detail: err instanceof Error ? err.message : String(err),
					});
				}
			}

			return updated;
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async delete(id: string): Promise<{ id: string; name: string }> {
		let deleted: { targets: StampTargets; name: string };

		try {
			deleted = await this.db.$transaction(async (tx) => {
				const targets = await this.stamp.targetsOf({ dealId: id }, tx);

				const deal = await tx.deal.delete({
					where: { id },
					select: { name: true },
				});

				return { targets, name: deal.name };
			});
		} catch (error) {
			throw this.translate(error, id);
		}

		await this.stamp.recomputeAfterDelete(deleted.targets, { dealId: id });

		this.logger.log({
			message: "Deal deleted",
			dealId: id,
			name: deleted.name,
		});

		return { id, name: deleted.name };
	}

	async setStage(input: SetStageInput, actingUserId: string) {
		const deal = await this.db.deal.findUnique({
			where: { id: input.id },
			select: { id: true, stage: true, companyId: true, engagementType: true },
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${input.id}.`);
		}

		if (deal.stage === input.stage) {
			// A deal won BEFORE the engagement-type rule shipped carries no type, and
			// this early return used to make that permanent: setStage refused to do
			// anything for a stage it was already in, and no other endpoint accepts
			// the field. So the obligations for every previously-won deal — including
			// a signed audit SOW — could never be created at all.
			//
			// Naming the type on an already-won deal is therefore a real operation,
			// not a no-op, and it spawns exactly what the original win would have.
			// Still guarded: only CLOSED_WON, only when a type is actually supplied,
			// and only when it CHANGES something.
			if (input.stage === "CLOSED_WON" && input.engagementType) {
				// Deliberately fires even when the type is UNCHANGED. Naming the
				// engagement type is what derives the contractual clocks, so restating
				// it RECONCILES them against the deal as it stands now.
				//
				// That matters because the dates hang off `closedAt`. Questback was
				// recorded as won on 8 Aug but its SOW was signed on 14 July, so every
				// obligation was three and a half weeks optimistic; correcting the date
				// left no way to re-derive them, and the only route was to cycle the
				// type through OTHER and back. An operation that exists only as a
				// workaround is not an operation.
				//
				// Safe to repeat: ensure() is idempotent on the obligation key, so this
				// either re-dates a row whose due date moved or does nothing at all. It
				// never duplicates — the partial unique index would reject that anyway.
				if (input.engagementType !== deal.engagementType) {
					await this.db.deal.update({
						where: { id: input.id },
						data: { engagementType: input.engagementType },
					});
				}
				let spawned: unknown = null;
				try {
					spawned = await this.obligations.spawnForWonDeal(
						deal.id,
						actingUserId,
					);
				} catch (err) {
					this.logger.error({
						message:
							"Could not spawn obligations for a back-filled engagement type",
						dealId: deal.id,
						detail: err instanceof Error ? err.message : String(err),
					});
				}
				this.logger.log({
					message: "Obligations reconciled on an already-won deal",
					dealId: deal.id,
					engagementType: input.engagementType,
					typeChanged: input.engagementType !== deal.engagementType,
					spawned,
				});
				return {
					id: deal.id,
					stage: deal.stage,
					changed: false,
					engagementTypeSet: input.engagementType,
					obligationsReconciled: true,
				};
			}
			return { id: deal.id, stage: deal.stage, changed: false };
		}

		const closedReason = input.closedReason?.trim();
		if (LOSING.has(input.stage) && !closedReason) {
			throw new BadRequestException(
				"Say why it was lost — a closed-lost deal with no reason teaches nobody anything.",
			);
		}

		// The winning mirror of the rule above. An audit engagement carries five
		// contractual deliverables and a 6-month re-check; a subscription carries
		// none. Nothing else in the schema distinguishes them, so closing a deal as
		// won while this is unknown would either invent deadlines or silently drop
		// real ones. Asked here because this is a transition the founder already
		// performs — a separate optional control would simply never be used.
		const engagementType = input.engagementType ?? deal.engagementType ?? null;
		if (input.stage === "CLOSED_WON" && !engagementType) {
			throw new BadRequestException(
				"Say what kind of engagement this was — an audit spawns five contractual deliverables and a 6-month re-check, a subscription spawns none.",
			);
		}

		const now = new Date();
		const closed = isClosedStage(input.stage);

		const [updated] = await this.db.$transaction([
			this.db.deal.update({
				where: { id: input.id },
				data: {
					stage: input.stage,
					...(engagementType ? { engagementType } : {}),
					stageChangedAt: now,
					closedAt: closed ? now : null,
					closedReason: closed ? (closedReason ?? null) : null,
				},
				select: { id: true, stage: true },
			}),
			this.db.activity.create({
				data: {
					type: ActivityType.STAGE_CHANGE,
					subject: "Stage changed",
					body: closedReason ?? null,
					occurredAt: now,
					companyId: deal.companyId,
					dealId: deal.id,
					createdById: actingUserId,
					meta: { from: deal.stage, to: input.stage },
				},
			}),
		]);

		await this.stamp.touch(
			{ companyId: deal.companyId, dealId: deal.id },
			new Date(),
		);

		this.logger.log({
			message: "Deal stage changed",
			dealId: deal.id,
			from: deal.stage,
			to: input.stage,
		});

		// A won audit deal carries five contractual obligations — report, VPAT/ACR,
		// statement, verification, and the 6-month re-check. They are identical every
		// time, which is exactly why they get forgotten: one signed deal here sat 23
		// days with none of them started. Spawning them from the stage change is the
		// only moment nobody has to remember anything.
		//
		// Deliberately OUTSIDE the transaction above and swallowed on failure: the
		// stage change is the user's action and must not roll back because a
		// follow-up task could not be written. spawnForWonDeal is idempotent, so a
		// missed spawn is recoverable by re-running it.
		// A deal moved to CONTRACT_SENT needs a Statement of Work drafted. The
		// document agent generates it (branded PDF + DocuSign DRAFT — it never
		// emails anyone), but only a human sends it. This spawns the reminder
		// TASK exactly once: skipped when any SOW task or DocuSign:SOW note
		// already exists on the deal. Same shape as the won-deal block below —
		// outside the transaction, swallowed on failure.
		if (input.stage === "CONTRACT_SENT") {
			try {
				const existingSow = await this.db.activity.findFirst({
					where: {
						dealId: deal.id,
						OR: [
							{ type: ActivityType.TASK, subject: { contains: "SOW" } },
							{ subject: { startsWith: "DocuSign:SOW" } },
						],
					},
					select: { id: true },
				});
				if (!existingSow) {
					const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
					await this.db.activity.create({
						data: {
							type: ActivityType.TASK,
							subject: "Generate SOW draft",
							body:
								`Contract stage reached with no SOW on file. Generate the draft: ` +
								`ask the CRM agent (or @abilyo) to "generate SOW for deal ${deal.id}". ` +
								`The document agent produces the branded PDF and a DocuSign DRAFT; ` +
								`sending remains a human action.`,
							occurredAt: now,
							dueAt: due,
							companyId: deal.companyId,
							dealId: deal.id,
							createdById: actingUserId,
							meta: { kind: "sow-draft", auto: true },
						},
					});
					this.logger.log({
						message: "Spawned SOW-draft task on CONTRACT_SENT",
						dealId: deal.id,
					});
				}
			} catch (err) {
				this.logger.error({
					message: "Could not spawn the SOW-draft task — the stage change stands",
					dealId: deal.id,
					detail: err instanceof Error ? err.message : String(err),
				});
			}
		}

		if (input.stage === "CLOSED_WON") {
			try {
				const spawned = await this.obligations.spawnForWonDeal(
					deal.id,
					actingUserId,
				);
				this.logger.log({
					message: "Spawned won-deal obligations",
					dealId: deal.id,
					...spawned,
				});
			} catch (err) {
				this.logger.error({
					message:
						"Could not spawn won-deal obligations — the stage change stands",
					dealId: deal.id,
					detail: err instanceof Error ? err.message : String(err),
				});
			}
		}

		return { ...updated, changed: true };
	}

	async contactOptions(dealId: string) {
		const deal = await this.db.deal.findUnique({
			where: { id: dealId },
			select: { companyId: true, contacts: { select: { contactId: true } } },
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${dealId}.`);
		}

		return this.db.contact.findMany({
			where: {
				companyId: deal.companyId,
				id: { notIn: deal.contacts.map((row) => row.contactId) },
			},
			select: CONTACT_SELECT,
			orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
			take: 100,
		});
	}

	async attachContact(input: DealAttachContactInput) {
		const company = await this.companyOf(input.dealId);
		const contact = await this.db.contact.findUnique({
			where: { id: input.contactId },
			select: { companyId: true },
		});

		if (!contact) {
			throw new NotFoundException(`No contact with id ${input.contactId}.`);
		}

		if (contact.companyId !== company.id) {
			throw new BadRequestException(
				`That contact does not work at ${company.name}.`,
			);
		}

		const role = roleOrNull(input.role ?? null);

		await this.db.dealContact.upsert({
			where: {
				dealId_contactId: {
					dealId: input.dealId,
					contactId: input.contactId,
				},
			},
			create: { dealId: input.dealId, contactId: input.contactId, role },
			update: role === null ? {} : { role },
		});

		this.logger.log({
			message: "Contact attached to deal",
			dealId: input.dealId,
			contactId: input.contactId,
		});

		return { dealId: input.dealId, contactId: input.contactId };
	}

	async detachContact(input: DealDetachContactInput) {
		const { count } = await this.db.dealContact.deleteMany({
			where: { dealId: input.dealId, contactId: input.contactId },
		});

		if (count === 0) {
			throw new NotFoundException("That contact is not on this deal.");
		}

		this.logger.log({
			message: "Contact detached from deal",
			dealId: input.dealId,
			contactId: input.contactId,
		});

		return { dealId: input.dealId, contactId: input.contactId };
	}

	async setContactRole(input: DealContactRoleInput) {
		const role = roleOrNull(input.role);

		const { count } = await this.db.dealContact.updateMany({
			where: { dealId: input.dealId, contactId: input.contactId },
			data: { role },
		});

		if (count === 0) {
			throw new NotFoundException("That contact is not on this deal.");
		}

		return { dealId: input.dealId, contactId: input.contactId, role };
	}

	async bulkAssignOwner(input: DealBulkOwnerInput): Promise<BulkResult> {
		await requireOwner(this.db, input.ownerId);

		const ids = [...new Set(input.ids)];
		const { count } = await this.db.deal.updateMany({
			where: { id: { in: ids } },
			data: { ownerId: input.ownerId },
		});

		this.logger.log({
			message: "Deals reassigned",
			count,
			ownerId: input.ownerId,
		});

		return {
			requested: ids.length,
			succeeded: count,
			failed: ids.length - count,
			message: null,
		};
	}

	async bulkSetStage(
		input: DealBulkStageInput,
		actingUserId: string,
	): Promise<BulkResult> {
		const closedReason = input.closedReason?.trim();

		if (LOSING.has(input.stage) && !closedReason) {
			throw new BadRequestException(
				"Say why they were lost — a closed-lost deal with no reason teaches nobody anything.",
			);
		}

		return runBulk(input.ids, (id) =>
			this.setStage(
				{
					id,
					stage: input.stage,
					closedReason,
					engagementType: input.engagementType,
				},
				actingUserId,
			),
		);
	}

	async bulkDelete(ids: string[]): Promise<BulkResult> {
		return runBulk(ids, (id) => this.delete(id));
	}

	private async companyOf(dealId: string) {
		const deal = await this.db.deal.findUnique({
			where: { id: dealId },
			select: { company: { select: { id: true, name: true } } },
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${dealId}.`);
		}

		return deal.company;
	}

	private searchFilter(q: string): Prisma.DealWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ name: { contains: term, mode: "insensitive" } },
				{ company: { name: { contains: term, mode: "insensitive" } } },
			],
		};
	}

	private buildWhere(input: DealListInput): Prisma.DealWhereInput {
		const where: Prisma.DealWhereInput = this.searchFilter(input.q);

		if (input.owner !== FACET_ALL) {
			where.ownerId =
				input.owner === FACET_UNASSIGNED ? { in: [] } : input.owner;
		}

		if (input.status === "open") {
			where.stage = { in: [...OPEN_DEAL_STAGES] };
		} else if (input.status === "closed") {
			where.stage = { in: [...CLOSED_DEAL_STAGES] };
		}

		if (input.stage !== FACET_ALL) {
			where.stage = input.stage as DealStage;
		}

		if (input.closing !== FACET_ALL) {
			Object.assign(where, closingFilter(input.closing as ClosingWindow));
		}

		return where;
	}

	private async facetCounts(input: DealListInput) {
		const where = this.searchFilter(input.q);

		const [owners, stages, ...closingCounts] = await Promise.all([
			this.db.deal.groupBy({ by: ["ownerId"], where, _count: { _all: true } }),
			this.db.deal.groupBy({ by: ["stage"], where, _count: { _all: true } }),
			...CLOSING_WINDOWS.map((window) =>
				this.db.deal.count({ where: { ...where, ...closingFilter(window) } }),
			),
		]);

		const stageCounts = countsByKey(stages, "stage");
		const openCount = OPEN_DEAL_STAGES.reduce(
			(total, stage) => total + (stageCounts[stage] ?? 0),
			0,
		);
		const closedCount = CLOSED_DEAL_STAGES.reduce(
			(total, stage) => total + (stageCounts[stage] ?? 0),
			0,
		);

		return {
			status: { open: openCount, closed: closedCount },
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			stage: stageCounts,
			closing: Object.fromEntries(
				CLOSING_WINDOWS.map((window, index) => [
					window,
					closingCounts[index] ?? 0,
				]),
			),
		};
	}

	private translate(error: unknown, id: string): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return new NotFoundException(`No deal with id ${id}.`);
		}
		return this.translateRelations(error);
	}

	private translateRelations(error: unknown): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			(error.code === "P2003" || error.code === "P2025")
		) {
			return new BadRequestException(
				"That company or owner does not exist any more.",
			);
		}
		return error;
	}
}

function closingFilter(window: ClosingWindow): Prisma.DealWhereInput {
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	const startOfMonthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);

	switch (window) {
		case "overdue":
			return {
				expectedCloseDate: { lt: now },
				stage: { in: [...OPEN_DEAL_STAGES] },
			};
		case "this-month":
			return {
				expectedCloseDate: { gte: startOfMonth, lt: startOfNextMonth },
			};
		case "next-month":
			return {
				expectedCloseDate: { gte: startOfNextMonth, lt: startOfMonthAfter },
			};
		case "later":
			return { expectedCloseDate: { gte: startOfMonthAfter } };
		case "none":
			return { expectedCloseDate: null };
	}
}

function roleOrNull(value: string | null): string | null {
	return value === null ? null : blankToNull(value);
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}
