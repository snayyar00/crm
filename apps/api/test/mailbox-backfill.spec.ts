import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db, type MailboxSyncModel as MailboxSync } from "@crm/db";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { EnrichmentLogService } from "../src/crm/enrichment-log.service";
import type { GmailClient, GmailMessage } from "../src/google/gmail.client";
import { GmailSyncService } from "../src/google/gmail-sync.service";
import { gmailBackfillInput } from "../src/google/google.contracts";
import type { CommitmentExtractorService } from "../src/mailbox/commitment-extractor.service";
import { MailboxMatchService } from "../src/mailbox/mailbox-match.service";
import type { MailboxTokenService } from "../src/mailbox/mailbox-token.service";
import { SyncStateService } from "../src/mailbox/sync-state.service";
import {
	type IncomingMessage,
	ThreadWriterService,
} from "../src/mailbox/thread-writer.service";
import { ObligationsService } from "../src/obligations/obligations.service";
import { withDiscardedCrmEvents } from "./agent-trigger.stub";

const suffix = process.env.TEST_RUN_ID ?? "mailbox-backfill-spec";
const knownDomain = `known-${suffix}.test`;
const unknownDomain = `unknown-${suffix}.test`;
const userId = `backfill-user-${suffix}`;
const mailbox = `rep-${suffix}@example.test`;
const person = `buyer@${knownDomain}`;
const stranger = `someone@${unknownDomain}`;

const SENT_AT = new Date("2026-10-01T10:00:00Z");
const UPDATED_AT = new Date("2026-09-01T10:00:00Z");
const NEWER_ACTIVITY = new Date("2026-11-01T10:00:00Z");

let companyCreated = 0;
let extractCalls = 0;

const agent = {
	contactCreated: async () => true,
	companyCreated: async () => {
		companyCreated += 1;
	},
	withCrmEvents: withDiscardedCrmEvents,
	companyRequested: async () => true,
} as unknown as AgentTriggerService;

const commitments = {
	extract: async () => {
		extractCalls += 1;
		return [
			{
				owner: "us",
				title: "Send the report",
				dueDate: "2026-10-05",
				confidence: 0.9,
				evidence: "the report by Monday",
			},
		];
	},
} as unknown as CommitmentExtractorService;

const stamp = new ActivityStampService(db);
const directory = new CompanyDirectoryService(agent);
const log = new EnrichmentLogService(db, stamp);
const match = new MailboxMatchService(db, directory, agent, log);
const obligations = new ObligationsService(db);
const threads = new ThreadWriterService(
	db,
	match,
	stamp,
	commitments,
	obligations,
);

let row: MailboxSync;
let companyId: string;
let sequence = 0;

function unique(label: string): string {
	sequence += 1;
	return `<${label}-${sequence}-${suffix}@mail.test>`;
}

function message(input: {
	id: string;
	to: string;
	sentAt?: Date;
	root?: string;
}): IncomingMessage {
	return {
		rfcMessageId: input.id,
		rootId: input.root ?? input.id,
		subject: `Backfill ${suffix}`,
		from: { email: mailbox, name: "Test Rep" },
		recipients: [{ email: input.to, name: "A Person", kind: "to" }],
		body: "I will send the report by Monday.",
		sentAt: input.sentAt ?? SENT_AT,
		gmailMessageId: null,
		outlookMessageId: null,
		outlookWebLink: null,
	};
}

function wire(input: { id: string; to: string; rfc: string }): GmailMessage {
	return {
		id: input.id,
		internalDate: String(SENT_AT.getTime()),
		payload: {
			mimeType: "text/plain",
			headers: [
				{ name: "Message-ID", value: input.rfc },
				{ name: "From", value: `Test Rep <${mailbox}>` },
				{ name: "To", value: input.to },
				{ name: "Subject", value: `Backfill ${suffix}` },
			],
			body: {
				data: Buffer.from("I will send the report by Monday.").toString(
					"base64url",
				),
			},
		},
	};
}

function backfillService(
	gmail: Partial<GmailClient>,
	tokens: Partial<MailboxTokenService> = {},
): GmailSyncService {
	return new GmailSyncService(
		db,
		{
			profile: async () => ({
				outcome: "ok",
				data: { emailAddress: mailbox, historyId: "1" },
			}),
			...gmail,
		} as unknown as GmailClient,
		{
			accessTokenFor: async () => ({
				outcome: "ok",
				accessToken: "token",
			}),
			...tokens,
		} as unknown as MailboxTokenService,
		new SyncStateService(db),
		threads,
	);
}

async function clean(): Promise<void> {
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.emailThread.deleteMany({
		where: { subject: `Backfill ${suffix}` },
	});
	await db.contact.deleteMany({
		where: { email: { in: [person, stranger] } },
	});
	await db.company.deleteMany({
		where: { domain: { in: [knownDomain, unknownDomain] } },
	});
	await db.mailboxSync.deleteMany({ where: { userId } });
	await db.user.deleteMany({ where: { id: userId } });
}

async function pinUpdatedAt(activityAt: Date | null): Promise<void> {
	await db.$executeRaw`UPDATE "company" SET "updatedAt" = ${UPDATED_AT}, "lastActivityAt" = ${activityAt} WHERE id = ${companyId}`;
}

async function companyRow() {
	return db.company.findUniqueOrThrow({
		where: { id: companyId },
		select: { updatedAt: true, lastActivityAt: true },
	});
}

beforeEach(async () => {
	await clean();
	companyCreated = 0;
	extractCalls = 0;

	await db.user.create({
		data: { id: userId, name: "Test Rep", email: mailbox },
	});
	row = await db.mailboxSync.create({
		data: { userId, source: "gmail", autoCreate: true, cursor: "cursor-kept" },
	});
	const company = await db.company.create({
		data: { name: "Known Co", domain: knownDomain },
		select: { id: true },
	});
	companyId = company.id;
	await db.contact.create({
		data: {
			firstName: "A",
			lastName: "Buyer",
			email: person,
			companyId,
		},
	});
	await pinUpdatedAt(null);
});

afterAll(clean);

describe("a live store on old mail is what the historical mode guards against", () => {
	it("extracts commitments and stamps the record as touched now", async () => {
		const stored = await threads.store(
			row,
			{ mailbox, origin: "gmail" },
			message({ id: unique("live"), to: person }),
			await threads.context(),
		);

		expect(stored).toBe(true);
		expect(extractCalls).toBe(1);

		const company = await companyRow();
		expect(company.updatedAt.getTime()).toBeGreaterThan(UPDATED_AT.getTime());
		expect(company.lastActivityAt?.getTime()).toBeGreaterThan(
			SENT_AT.getTime(),
		);
	});

	it("creates a company for an outbound mail to an unknown domain", async () => {
		const stored = await threads.store(
			row,
			{ mailbox, origin: "gmail" },
			message({ id: unique("live-new"), to: stranger }),
			await threads.context(),
		);

		expect(stored).toBe(true);
		expect(await db.company.count({ where: { domain: unknownDomain } })).toBe(
			1,
		);
	});
});

describe("storing historical mail", () => {
	it("does not read the mail for commitments", async () => {
		const stored = await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id: unique("old"), to: person }),
			await threads.context(),
		);

		expect(stored).toBe(true);
		expect(extractCalls).toBe(0);
		expect(
			await db.activity.count({
				where: { companyId, type: { not: "EMAIL" } },
			}),
		).toBe(0);
	});

	it("dates the activity at the mail and leaves updatedAt alone", async () => {
		const id = unique("dated");

		await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id, to: person }),
			await threads.context(),
		);

		const company = await companyRow();
		expect(company.updatedAt).toEqual(UPDATED_AT);
		expect(company.lastActivityAt).toEqual(SENT_AT);

		const activity = await db.activity.findFirstOrThrow({
			where: { emailThread: { rootMessageId: id } },
			select: { createdAt: true, occurredAt: true },
		});
		expect(activity.createdAt).toEqual(SENT_AT);
		expect(activity.occurredAt).toEqual(SENT_AT);
	});

	it("never moves lastActivityAt backwards", async () => {
		await pinUpdatedAt(NEWER_ACTIVITY);

		await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id: unique("older"), to: person }),
			await threads.context(),
		);

		expect((await companyRow()).lastActivityAt).toEqual(NEWER_ACTIVITY);
	});

	it("creates no company for an unknown domain", async () => {
		const stored = await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id: unique("unknown"), to: stranger }),
			await threads.context(),
		);

		expect(stored).toBe(false);
		expect(companyCreated).toBe(0);
		expect(await db.company.count({ where: { domain: unknownDomain } })).toBe(
			0,
		);
	});

	it("joins an existing thread even without a participant match", async () => {
		const root = unique("root");

		await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id: root, to: person }),
			await threads.context(),
		);

		const stored = await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id: unique("reply"), to: stranger, root }),
			await threads.context(),
		);

		expect(stored).toBe(true);
		const thread = await db.emailThread.findUniqueOrThrow({
			where: { rootMessageId: root },
			select: { messageCount: true },
		});
		expect(thread.messageCount).toBe(2);
	});
});

describe("previewing historical mail", () => {
	it("reports the store decision and writes nothing", async () => {
		const context = await threads.context();
		const stored = unique("stored");

		await threads.store(
			row,
			{ mailbox, origin: "gmail", historical: true },
			message({ id: stored, to: person }),
			context,
		);

		const before = await db.emailMessage.count({
			where: { syncedByUserId: userId },
		});

		const fresh = await threads.preview(
			row,
			message({ id: unique("fresh"), to: person }),
			context,
		);
		const none = await threads.preview(
			row,
			message({ id: unique("none"), to: stranger }),
			context,
		);
		const repeat = await threads.preview(
			row,
			message({ id: stored, to: person }),
			context,
		);

		expect(fresh).toEqual({ outcome: "store", companyId });
		expect(none).toEqual({ outcome: "no-match" });
		expect(repeat).toEqual({ outcome: "already-stored" });
		expect(
			await db.emailMessage.count({ where: { syncedByUserId: userId } }),
		).toBe(before);
	});
});

describe("backfilling a Gmail window", () => {
	const window = {
		email: mailbox,
		after: new Date("2026-09-21T00:00:00Z"),
		before: new Date("2026-11-04T00:00:00Z"),
	};

	function pagedGmail(input: { rfcKnown: string; rfcStranger: string }) {
		const seen: { after: Date; before: Date; pageToken?: string }[] = [];
		const gmail: Partial<GmailClient> = {
			listMessages: async (_token, options) => {
				seen.push(options);
				return {
					outcome: "ok",
					data: {
						messages: [{ id: "known" }, { id: "stranger" }, { id: "broken" }],
						nextPageToken: "page-2",
					},
				};
			},
			getMessage: async (_token, id) => {
				if (id === "broken") {
					return { outcome: "failed", reason: "boom", retryable: true };
				}
				return {
					outcome: "ok",
					data:
						id === "known"
							? wire({ id, to: person, rfc: input.rfcKnown })
							: wire({ id, to: stranger, rfc: input.rfcStranger }),
				};
			},
		};
		return { gmail, seen };
	}

	it("counts a dry run without writing", async () => {
		const { gmail, seen } = pagedGmail({
			rfcKnown: unique("wire-known"),
			rfcStranger: unique("wire-stranger"),
		});

		const report = await backfillService(gmail).backfillPage({
			...window,
			dryRun: true,
		});

		expect(report).toEqual({
			status: "ok",
			dryRun: true,
			listed: 3,
			stored: 1,
			alreadyStored: 0,
			noMatch: 1,
			failed: 1,
			companyIds: [companyId],
			nextPageToken: "page-2",
		});
		expect(seen[0]?.after).toEqual(window.after);
		expect(seen[0]?.before).toEqual(window.before);
		expect(
			await db.emailMessage.count({ where: { syncedByUserId: userId } }),
		).toBe(0);
	});

	it("stores a real run, keeps the cursor, and repeats safely", async () => {
		const { gmail } = pagedGmail({
			rfcKnown: unique("wire-known"),
			rfcStranger: unique("wire-stranger"),
		});
		const service = backfillService(gmail);

		const first = await service.backfillPage({ ...window, dryRun: false });
		const second = await service.backfillPage({ ...window, dryRun: false });

		expect(first.status === "ok" && first.stored).toBe(1);
		expect(second.status === "ok" && second.stored).toBe(0);
		expect(second.status === "ok" && second.alreadyStored).toBe(1);
		expect(extractCalls).toBe(0);
		expect(
			await db.emailMessage.count({ where: { syncedByUserId: userId } }),
		).toBe(1);

		const after = await db.mailboxSync.findUniqueOrThrow({
			where: { id: row.id },
			select: { cursor: true, status: true },
		});
		expect(after.cursor).toBe("cursor-kept");
		expect(after.status).toBe(row.status);
	});

	it("passes the page token on", async () => {
		const { gmail, seen } = pagedGmail({
			rfcKnown: unique("wire-known"),
			rfcStranger: unique("wire-stranger"),
		});

		await backfillService(gmail).backfillPage({
			...window,
			dryRun: true,
			pageToken: "page-2",
		});

		expect(seen[0]?.pageToken).toBe("page-2");
	});

	it("reports a rate limit and does not mark the sync row", async () => {
		const report = await backfillService({
			listMessages: async () => ({
				outcome: "rate-limited",
				reason: "slow down",
				retryAfterMs: 60_000,
			}),
		}).backfillPage({ ...window, dryRun: true });

		expect(report).toEqual({ status: "rate-limited", reason: "slow down" });

		const after = await db.mailboxSync.findUniqueOrThrow({
			where: { id: row.id },
			select: { status: true, retryAfter: true },
		});
		expect(after.status).toBe(row.status);
		expect(after.retryAfter).toBeNull();
	});

	it("refuses an address with no Gmail sync", async () => {
		const report = await backfillService({}).backfillPage({
			...window,
			email: `nobody-${suffix}@example.test`,
			dryRun: true,
		});

		expect(report.status).toBe("not-connected");
	});
});

describe("the backfill input", () => {
	const body = {
		email: "rep@example.test",
		after: "2026-09-21T08:14:05Z",
		before: "2026-11-04T20:56:02Z",
	};

	it("defaults to a dry run", () => {
		expect(gmailBackfillInput.parse(body).dryRun).toBe(true);
	});

	it("refuses a string for dryRun", () => {
		expect(
			gmailBackfillInput.safeParse({ ...body, dryRun: "false" }).success,
		).toBe(false);
	});

	it("refuses a window that ends before it starts", () => {
		expect(
			gmailBackfillInput.safeParse({
				...body,
				after: body.before,
				before: body.after,
			}).success,
		).toBe(false);
	});
});
