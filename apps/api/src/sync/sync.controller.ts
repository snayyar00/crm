import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { EmailDispatchService } from "../email/email-dispatch.service";
import { ObligationDigestService } from "../obligations/obligation-digest.service";
import { MailboxSyncService } from "./mailbox-sync.service";

@Controller("internal/sync")
export class SyncController {
	private readonly logger = new Logger(SyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly sync: MailboxSyncService,
		private readonly emails: EmailDispatchService,
		private readonly obligationDigest: ObligationDigestService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("mailboxes")
	@AllowAnonymous()
	async mailboxesViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("mailboxes")
	@AllowAnonymous()
	async mailboxesViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Get("google")
	@AllowAnonymous()
	async googleViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("google")
	@AllowAnonymous()
	async googleViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Get("emails")
	@AllowAnonymous()
	async emailsViaGet(@Headers("authorization") authorization?: string) {
		return this.runEmails(authorization);
	}

	@Post("emails")
	@AllowAnonymous()
	async emailsViaPost(@Headers("authorization") authorization?: string) {
		return this.runEmails(authorization);
	}

	@Get("obligations")
	@AllowAnonymous()
	async obligationsViaGet(@Headers("authorization") authorization?: string) {
		return this.runObligations(authorization);
	}

	@Post("obligations")
	@AllowAnonymous()
	async obligationsViaPost(@Headers("authorization") authorization?: string) {
		return this.runObligations(authorization);
	}

	/**
	 * Fires the obligation alarm. Returns { sent: false, reason: 'clean' } on a day
	 * with nothing overdue — a quiet run is the expected outcome, not a failure, and
	 * a scheduler seeing that every morning is the system working.
	 *
	 * The recipient is read from OBLIGATION_DIGEST_TO and pinned here, so the
	 * queue-bypass in ObligationDigestService can only ever address the founder.
	 */
	private async runObligations(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message:
					"CRON_SECRET is not set — refusing to run the obligation alarm.",
			});
			throw new ServiceUnavailableException(
				"Obligation alarm is not configured.",
			);
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
		const to = process.env.OBLIGATION_DIGEST_TO;
		if (!to) {
			this.logger.error({
				message:
					"OBLIGATION_DIGEST_TO is not set — refusing to guess a recipient.",
			});
			throw new ServiceUnavailableException("No digest recipient configured.");
		}
		const owner = await this.obligationDigest.ownerId();
		return this.obligationDigest.run(to, owner);
	}

	/** Drains QUEUED email jobs. Same bearer contract as the mailbox route. */
	private async runEmails(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run email dispatch.",
			});
			throw new ServiceUnavailableException(
				"Email dispatch is not configured.",
			);
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
		return this.emails.runDue();
	}

	private async run(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the sync route.",
			});
			throw new ServiceUnavailableException("Sync is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		return this.sync.runDue();
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
