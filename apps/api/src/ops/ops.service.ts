import { type Db, GoogleSyncStatus } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export type CronHealth = "ok" | "late" | "error" | "unknown";

const HEARTBEAT_PREFIX = "cron.heartbeat.";

const EXTERNAL_CRONS = [
	{
		id: "intercom-sync",
		name: "Intercom → CRM notes",
		where: "CRM host (root crontab, hourly at :17)",
		purpose:
			"Copies Intercom conversation state onto company records so support context is visible next to deals.",
		expectEveryMinutes: 75,
	},
	{
		id: "crm-ads-sync",
		name: "Ads/GTM state → CRM note",
		where: "Sid's Mac (launchd agent, hourly at :26)",
		purpose:
			"Auto-syncs ads readiness (GTM, spend gates) into the 'Ads readiness state' note on the Webability company; Hermes reads it in Slack.",
		expectEveryMinutes: 75,
	},
	{
		id: "crm-reply-watch",
		name: "Inbound-reply Slack alert",
		where: "CRM host (root crontab, every 15 min)",
		purpose:
			"Posts to #crm-deals when the Gmail sync ingests an inbound email on a tracked company or deal.",
		expectEveryMinutes: 35,
	},
] as const;

@Injectable()
export class OpsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async crons() {
		const now = Date.now();

		const [syncRows, users, triggers, beats] = await Promise.all([
			this.db.mailboxSync.findMany({ orderBy: { userId: "asc" } }),
			this.db.user.findMany({ select: { id: true, email: true } }),
			this.db.agentTrigger.findMany({
				include: { agent: { select: { name: true } } },
			}),
			this.db.telemetryCounter.findMany({
				where: { name: { startsWith: HEARTBEAT_PREFIX } },
			}),
		]);

		const email = new Map(users.map((u) => [u.id, u.email]));

		const syncs = syncRows.map((s) => {
			const ageMin = s.lastSyncedAt
				? (now - s.lastSyncedAt.getTime()) / 60_000
				: null;
			const health: CronHealth = s.lastError
				? "error"
				: ageMin === null
					? "unknown"
					: ageMin > 30
						? "late"
						: "ok";
			return {
				id: s.id,
				mailbox: email.get(s.userId) ?? s.userId,
				source: s.source,
				status: s.status,
				running: s.status === GoogleSyncStatus.RUNNING,
				lastSyncedAt: s.lastSyncedAt,
				lastError: s.lastError,
				health,
			};
		});

		const agentTriggers = triggers.map((t) => {
			const cfg = t.config as { intervalMinutes?: number } | null;
			const interval = cfg?.intervalMinutes ?? 60;
			const overdueMin = t.nextRunAt
				? (now - t.nextRunAt.getTime()) / 60_000
				: null;
			const health: CronHealth = !t.enabled
				? "unknown"
				: overdueMin === null
					? "unknown"
					: overdueMin > interval
						? "late"
						: "ok";
			return {
				id: t.id,
				agent: t.agent.name,
				name: t.name,
				enabled: t.enabled,
				intervalMinutes: interval,
				lastRunAt: t.lastRunAt,
				nextRunAt: t.nextRunAt,
				health,
			};
		});

		const beat = new Map(beats.map((b) => [b.name, b]));
		const external = EXTERNAL_CRONS.map((c) => {
			const b = beat.get(HEARTBEAT_PREFIX + c.id);
			const ageMin = b ? (now - b.updatedAt.getTime()) / 60_000 : null;
			const health: CronHealth =
				ageMin === null
					? "unknown"
					: ageMin > c.expectEveryMinutes
						? "late"
						: "ok";
			return {
				...c,
				lastBeatAt: b?.updatedAt ?? null,
				totalRuns: b?.count ?? 0,
				health,
			};
		});

		return { syncs, agentTriggers, external, generatedAt: new Date() };
	}
}
