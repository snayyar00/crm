import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
	GOOGLE_PROVIDER_ID,
	MICROSOFT_PROVIDER_ID,
	OUTLOOK_MAIL_SCOPE,
	SYNC_SCOPES,
} from "@crm/auth/scopes";
import { db, GoogleSyncStatus } from "@crm/db";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { GoogleConnectionService } from "../src/google/google-connection.service";
import type { MailboxMatchService } from "../src/mailbox/mailbox-match.service";
import { MailboxTokenService } from "../src/mailbox/mailbox-token.service";
import { SyncStateService } from "../src/mailbox/sync-state.service";
import { MicrosoftConnectionService } from "../src/microsoft/microsoft-connection.service";

const suffix = process.env.TEST_RUN_ID ?? "mailbox-reconnect-spec";
const userId = `reconnect-rep-${suffix}`;

const tokens = new MailboxTokenService(db);
const state = new SyncStateService(db);
const stamp = new ActivityStampService(db);

const google = new GoogleConnectionService(
	db,
	tokens,
	state,
	{} as unknown as MailboxMatchService,
	stamp,
);
const microsoft = new MicrosoftConnectionService(db, tokens, state, stamp);

const LOST_AT = new Date(Date.UTC(2026, 8, 21));
const BEFORE_LOSS = new Date(Date.UTC(2026, 8, 20));
const AFTER_LOSS = new Date(Date.UTC(2026, 10, 4));

async function clean(): Promise<void> {
	await db.mailboxSync.deleteMany({ where: { userId } });
	await db.account.deleteMany({ where: { userId } });
	await db.user.deleteMany({ where: { id: userId } });
}

async function lost(source: string): Promise<void> {
	const row = await db.mailboxSync.create({
		data: {
			userId,
			source,
			status: GoogleSyncStatus.NEEDS_RECONNECT,
			lastError: "invalid credentials",
			cursor: "cursor-kept",
		},
	});
	await db.$executeRaw`UPDATE "mailboxSync" SET "updatedAt" = ${LOST_AT} WHERE id = ${row.id}`;
}

async function account(
	providerId: string,
	scope: string,
	updatedAt: Date,
): Promise<void> {
	const row = await db.account.create({
		data: {
			id: `${providerId}-${suffix}`,
			accountId: `${providerId}-account-${suffix}`,
			providerId,
			userId,
			scope,
		},
	});
	await db.$executeRaw`UPDATE account SET "updatedAt" = ${updatedAt} WHERE id = ${row.id}`;
}

async function row(source: string) {
	return db.mailboxSync.findFirstOrThrow({ where: { userId, source } });
}

beforeEach(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: userId, email: `${userId}@reconnect.test` },
	});
});

afterAll(clean);

describe("reconnecting a mailbox", () => {
	it("restarts a Google sync the account was reconnected after losing", async () => {
		await account(GOOGLE_PROVIDER_ID, SYNC_SCOPES.join(" "), AFTER_LOSS);
		await lost("gmail");
		await lost("calendar");

		await google.onConnected(userId);

		const gmail = await row("gmail");
		expect(gmail.status).toBe(GoogleSyncStatus.IDLE);
		expect(gmail.lastError).toBeNull();
		expect(gmail.cursor).toBe("cursor-kept");
		expect((await row("calendar")).status).toBe(GoogleSyncStatus.IDLE);
	});

	it("leaves a sync waiting when the account has not changed since", async () => {
		await account(GOOGLE_PROVIDER_ID, SYNC_SCOPES.join(" "), BEFORE_LOSS);
		await lost("gmail");

		await google.onConnected(userId);

		const gmail = await row("gmail");
		expect(gmail.status).toBe(GoogleSyncStatus.NEEDS_RECONNECT);
		expect(gmail.lastError).toBe("invalid credentials");
	});

	it("restarts a Microsoft sync the same way", async () => {
		await account(MICROSOFT_PROVIDER_ID, OUTLOOK_MAIL_SCOPE, AFTER_LOSS);
		await lost("outlook");

		await microsoft.onConnected(userId);

		expect((await row("outlook")).status).toBe(GoogleSyncStatus.IDLE);
	});
});
