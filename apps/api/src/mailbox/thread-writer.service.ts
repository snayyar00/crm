import {
	ActivityType,
	type Db,
	EmailDirection,
	type MailboxSyncModel as MailboxSync,
	type Prisma,
	Prisma as PrismaNamespace,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { ObligationsService } from "../obligations/obligations.service";
import { CommitmentExtractorService } from "./commitment-extractor.service";
import type { SyncSource } from "./mailbox.constants";
import {
	MailboxMatchService,
	type MatchContext,
} from "./mailbox-match.service";
import { snippetOf } from "./message-text";
import type { Participant } from "./participants";

export type IncomingMessage = {
	rfcMessageId: string;
	rootId: string;
	subject: string | null;
	from: Participant;
	recipients: { email: string; name: string | null; kind: "to" | "cc" }[];
	body: string;
	sentAt: Date;
	gmailMessageId?: string | null;
	outlookMessageId?: string | null;
	outlookWebLink?: string | null;
};

export type HistoricalPreview =
	| { outcome: "store"; companyId: string | null }
	| { outcome: "no-match" }
	| { outcome: "already-stored" };

type StoredMessage = {
	threadId: string;
	thread: {
		companyId: string | null;
		contactId: string | null;
		activity: { id: string } | null;
	};
};

type RecordLink = { companyId: string | null; contactId: string | null };

@Injectable()
export class ThreadWriterService {
	private readonly logger = new Logger(ThreadWriterService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly match: MailboxMatchService,
		private readonly stamp: ActivityStampService,
		private readonly commitments: CommitmentExtractorService,
		private readonly obligations: ObligationsService,
	) {}

	async context(): Promise<MatchContext> {
		const [internal, suppressedDomains, suppressedEmails] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
			this.match.suppressedEmails(),
		]);

		return {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
			suppressedEmails,
		};
	}

	async store(
		row: MailboxSync,
		options: { mailbox: string; origin: SyncSource; historical?: boolean },
		parsed: IncomingMessage,
		context: MatchContext,
	): Promise<boolean> {
		const historical = options.historical ?? false;

		const existing = await this.findStored(parsed.rfcMessageId);
		if (existing?.thread.activity) return false;

		const repair = existing !== null;
		const outbound = parsed.from.email === options.mailbox;

		const link = await this.link(
			existing,
			parsed,
			context,
			async () =>
				!historical &&
				row.autoCreate &&
				(outbound ||
					(await this.hasOutboundInThread(parsed.rootId, options.mailbox))),
			row.userId,
		);
		if (!link) return false;

		const { companyId, contactId } = link;

		let occurredAt: Date;
		// captured inside the transaction so the post-commit extraction can key on it
		let storedThreadId = "";

		try {
			occurredAt = await this.db.$transaction(async (tx) => {
				const record = existing
					? { id: existing.threadId }
					: await tx.emailThread.upsert({
							where: { rootMessageId: parsed.rootId },
							create: {
								rootMessageId: parsed.rootId,
								subject: parsed.subject,
								companyId,
								contactId,
								firstMessageAt: parsed.sentAt,
								lastMessageAt: parsed.sentAt,
								messageCount: 0,
							},
							update: {},
							select: { id: true },
						});

				if (!repair) {
					storedThreadId = record.id;

					await tx.emailMessage.create({
						data: {
							threadId: record.id,
							rfcMessageId: parsed.rfcMessageId,
							syncedByUserId: row.userId,
							gmailMessageId: parsed.gmailMessageId ?? null,
							outlookMessageId: parsed.outlookMessageId ?? null,
							outlookWebLink: parsed.outlookWebLink ?? null,
							direction: outbound
								? EmailDirection.OUTBOUND
								: EmailDirection.INBOUND,
							fromEmail: parsed.from.email,
							fromName: parsed.from.name,
							recipients: parsed.recipients,
							subject: parsed.subject,
							snippet: snippetOf(parsed.body),
							body: parsed.body || null,
							sentAt: parsed.sentAt,
						},
					});
				}

				const stats = await tx.emailMessage.aggregate({
					where: { threadId: record.id },
					_count: { _all: true },
					_min: { sentAt: true },
					_max: { sentAt: true },
				});

				const firstMessageAt = stats._min.sentAt ?? parsed.sentAt;
				const lastMessageAt = stats._max.sentAt ?? parsed.sentAt;

				const data: Prisma.EmailThreadUpdateInput = {
					messageCount: stats._count._all,
					firstMessageAt,
					lastMessageAt,
				};

				if (parsed.sentAt <= firstMessageAt) data.subject = parsed.subject;

				await tx.emailThread.update({ where: { id: record.id }, data });

				return this.project(tx, record.id, row.userId, {
					subject: parsed.subject ?? "(no subject)",
					snippet: snippetOf(parsed.body),
					lastMessageAt,
					companyId,
					contactId,
					origin: options.origin,
					createdAt: historical ? parsed.sentAt : undefined,
				});
			});
		} catch (error) {
			if (await this.storedElsewhere(error, parsed.rfcMessageId)) return false;
			throw error;
		}

		await this.touch(
			{ companyId, contactId },
			historical ? parsed.sentAt : occurredAt,
			parsed.rfcMessageId,
			historical,
		);

		// Read what the mail SAID, not just that it arrived. Deliberately AFTER the
		// transaction commits and deliberately unawaited-by-value: a model call must
		// never hold a DB transaction open, and must never fail a sync that has
		// already stored the message correctly.
		if (!repair && companyId && !historical) {
			await this.extractCommitments({
				threadId: storedThreadId,
				companyId,
				parsed,
				userId: row.userId,
			});
		}

		return !repair;
	}

	async preview(
		row: MailboxSync,
		parsed: IncomingMessage,
		context: MatchContext,
	): Promise<HistoricalPreview> {
		const existing = await this.findStored(parsed.rfcMessageId);
		if (existing?.thread.activity) return { outcome: "already-stored" };

		const link = await this.link(
			existing,
			parsed,
			context,
			async () => false,
			row.userId,
		);
		if (!link) return { outcome: "no-match" };

		return { outcome: "store", companyId: link.companyId };
	}

	private async findStored(
		rfcMessageId: string,
	): Promise<StoredMessage | null> {
		return this.db.emailMessage.findUnique({
			where: { rfcMessageId },
			select: {
				threadId: true,
				thread: {
					select: {
						companyId: true,
						contactId: true,
						activity: { select: { id: true } },
					},
				},
			},
		});
	}

	private async link(
		existing: StoredMessage | null,
		parsed: IncomingMessage,
		context: MatchContext,
		allowCreate: () => Promise<boolean>,
		ownerId: string,
	): Promise<RecordLink | null> {
		if (existing) {
			return {
				companyId: existing.thread.companyId,
				contactId: existing.thread.contactId,
			};
		}

		const thread = await this.db.emailThread.findUnique({
			where: { rootMessageId: parsed.rootId },
			select: { companyId: true, contactId: true },
		});
		if (thread) return thread;

		const match = await this.match.resolve(
			{
				participants: [parsed.from, ...parsed.recipients],
				allowCreate: await allowCreate(),
				source: RecordSource.EMAIL,
				ownerId,
			},
			context,
		);

		if (!match.companyId && !match.contactId) return null;

		return { companyId: match.companyId, contactId: match.contactId };
	}

	/** Never throws - a failed extraction must not fail the mailbox sync. */
	private async extractCommitments(input: {
		threadId: string;
		companyId: string;
		parsed: IncomingMessage;
		userId: string;
	}): Promise<void> {
		try {
			const company = await this.db.company.findUnique({
				where: { id: input.companyId },
				select: { name: true },
			});

			const found = await this.commitments.extract({
				subject: input.parsed.subject ?? "",
				body: input.parsed.body ?? "",
				fromEmail: input.parsed.from.email,
				companyName: company?.name ?? "(unknown)",
				sentAt: input.parsed.sentAt,
			});

			for (const c of found) {
				await this.obligations.spawnFromEmail({
					companyId: input.companyId,
					threadId: input.threadId,
					title: c.title,
					// The quote is the audit trail: when an obligation looks wrong, this
					// is how you tell a real commitment from a hallucinated one.
					body: `From ${input.parsed.from.email}: "${c.evidence}"`,
					dueAt: new Date(`${c.dueDate}T09:00:00Z`),
					createdById: input.userId,
				});
			}

			if (found.length > 0) {
				this.logger.log({
					message: "Commitments extracted from email",
					threadId: input.threadId,
					count: found.length,
				});
			}
		} catch (error) {
			this.logger.warn({
				message: "Commitment extraction failed; the email is still stored",
				threadId: input.threadId,
				error,
			});
		}
	}

	private async storedElsewhere(
		cause: unknown,
		rfcMessageId: string,
	): Promise<boolean> {
		const duplicate =
			cause instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			cause.code === "P2002";
		if (!duplicate) return false;

		const winner = await this.db.emailMessage.findFirst({
			where: { rfcMessageId, thread: { activity: { isNot: null } } },
			select: { id: true },
		});

		return winner !== null;
	}

	private async touch(
		target: { companyId: string | null; contactId: string | null },
		at: Date,
		rfcMessageId: string,
		historical: boolean,
	): Promise<void> {
		try {
			if (historical) {
				await this.stamp.backdate(target, at);
			} else {
				await this.stamp.touch(target, at);
			}
		} catch (error) {
			this.logger.error(
				{
					message: "An email was stored but its activity stamps were not moved",
					rfcMessageId,
					...target,
				},
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	private async hasOutboundInThread(
		rootMessageId: string,
		mailbox: string,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				thread: { rootMessageId },
				fromEmail: mailbox,
			},
			select: { id: true },
		});

		return found !== null;
	}

	private async project(
		tx: Prisma.TransactionClient,
		emailThreadId: string,
		userId: string,
		summary: {
			subject: string;
			snippet: string | null;
			lastMessageAt: Date;
			companyId: string | null;
			contactId: string | null;
			origin: SyncSource;
			createdAt?: Date;
		},
	): Promise<Date> {
		const activity = await tx.activity.upsert({
			where: { emailThreadId },
			create: {
				type: ActivityType.EMAIL,
				subject: summary.subject,
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				emailThreadId,
				meta: { synced: true, source: summary.origin },
				createdAt: summary.createdAt,
			},
			update: {
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
			},
			select: { createdAt: true },
		});

		return activity.createdAt;
	}
}
