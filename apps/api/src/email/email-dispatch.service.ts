import type { Db } from "@crm/db";
import { isEmailConfigured, sendEmail } from "@crm/email";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * Drains the EmailJob queue.
 *
 * Only ever picks up QUEUED rows whose dueAt has passed. A DRAFT is never sent —
 * releasing a draft is an explicit human act (emails.release), because a queue
 * that mails on a timer is one bad row away from sending a customer the wrong
 * thing.
 *
 * Claiming uses the same lease pattern as the agent's task queue: the status flips
 * to SENDING inside a transaction, so two dispatchers cannot send the same row.
 */
@Injectable()
export class EmailDispatchService {
	private readonly logger = new Logger(EmailDispatchService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async runDue(
		limit = 10,
	): Promise<{ sent: number; failed: number; skipped: number }> {
		if (!isEmailConfigured()) {
			this.logger.warn({
				message: "BREVO_API_KEY is not set — email dispatch is a no-op.",
			});
			return { sent: 0, failed: 0, skipped: 0 };
		}

		const now = new Date();
		let sent = 0;
		let failed = 0;

		for (let i = 0; i < limit; i += 1) {
			// Claim one row. The updateMany-with-status-guard is the lock: a second
			// dispatcher racing us updates 0 rows and moves on.
			const candidate = await this.db.emailJob.findFirst({
				where: {
					status: "QUEUED",
					OR: [{ dueAt: null }, { dueAt: { lte: now } }],
				},
				orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
			});
			if (!candidate) break;

			const claimed = await this.db.emailJob.updateMany({
				where: { id: candidate.id, status: "QUEUED" },
				data: { status: "SENDING", attempts: { increment: 1 } },
			});
			if (claimed.count === 0) continue; // someone else took it

			try {
				const attachments = Array.isArray(candidate.attachments)
					? (candidate.attachments as { name: string; content: string }[])
					: undefined;

				const result = await sendEmail({
					to: candidate.to,
					cc: candidate.cc.length ? candidate.cc : undefined,
					subject: candidate.subject,
					text: candidate.body,
					attachments,
					tag: "crm",
				});

				await this.db.emailJob.update({
					where: { id: candidate.id },
					data: {
						status: "SENT",
						sentAt: new Date(),
						messageId: result.messageId,
						error: null,
					},
				});

				// The send is the fact worth keeping — log it where a human will look.
				if (candidate.dealId || candidate.contactId || candidate.companyId) {
					await this.db.activity.create({
						data: {
							type: "EMAIL",
							subject: candidate.subject,
							body: `Sent to ${candidate.to.join(", ")}${candidate.cc.length ? ` (cc ${candidate.cc.join(", ")})` : ""}\n\n${candidate.body}`,
							occurredAt: new Date(),
							dealId: candidate.dealId,
							contactId: candidate.contactId,
							companyId: candidate.companyId,
							createdById: candidate.createdById,
						},
					});
				}

				sent += 1;
				this.logger.log({
					message: "Email sent",
					id: candidate.id,
					to: candidate.to,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				// Three strikes, then it stops and waits for a human. Retrying a
				// rejected send forever just burns credits and fills the log.
				const giveUp = candidate.attempts + 1 >= 3;
				await this.db.emailJob.update({
					where: { id: candidate.id },
					data: {
						status: giveUp ? "FAILED" : "QUEUED",
						error: message.slice(0, 500),
					},
				});
				failed += 1;
				this.logger.error({
					message: "Email send failed",
					id: candidate.id,
					attempts: candidate.attempts + 1,
					giveUp,
					detail: message,
				});
			}
		}

		return { sent, failed, skipped: 0 };
	}
}
