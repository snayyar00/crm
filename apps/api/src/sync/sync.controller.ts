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
import { MailboxSyncService } from "./mailbox-sync.service";

@Controller("internal/sync")
export class SyncController {
	private readonly logger = new Logger(SyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly sync: MailboxSyncService,
		private readonly emails: EmailDispatchService,
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

	/** Drains QUEUED email jobs. Same bearer contract as the mailbox route. */
	private async runEmails(authorization?: string) {
		if (!this.secret) {
			this.logger.error({ message: "CRON_SECRET is not set — refusing to run email dispatch." });
			throw new ServiceUnavailableException("Email dispatch is not configured.");
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
