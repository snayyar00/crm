import {
	BadRequestException,
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	Req,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	ApiExcludeEndpoint,
	ApiForbiddenResponse,
	ApiHeader,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
} from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Request } from "express";
import type { EnvironmentVariables } from "../config/env.validation";
import { EmailDispatchService } from "../email/email-dispatch.service";
import { gmailBackfillInput } from "../google/google.contracts";
import { GoogleSyncService } from "../google/google-sync.service";
import { ObligationDigestService } from "../obligations/obligation-digest.service";
import { MailboxSyncService } from "./mailbox-sync.service";

@ApiTags("Internal — Cron")
@ApiHeader({
	name: "authorization",
	description: "`Bearer <CRON_SECRET>`",
	required: true,
})
@ApiForbiddenResponse({ description: "CRON_SECRET did not match." })
@ApiServiceUnavailableResponse({ description: "CRON_SECRET is not set." })
@Controller("internal/sync")
export class SyncController {
	private readonly logger = new Logger(SyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly sync: MailboxSyncService,
		private readonly google: GoogleSyncService,
		private readonly emails: EmailDispatchService,
		private readonly obligationDigest: ObligationDigestService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("mailboxes")
	@AllowAnonymous()
	@ApiOperation({ summary: "Run any due Gmail, Outlook or calendar sync" })
	@ApiOkResponse({ description: "The sync ran; per-mailbox results." })
	async mailboxesViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("mailboxes")
	@AllowAnonymous()
	@ApiExcludeEndpoint()
	async mailboxesViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Get("google")
	@AllowAnonymous()
	@ApiOperation({
		summary: "Alias of `mailboxes`, kept for existing cron deployments",
	})
	@ApiOkResponse({ description: "The sync ran; per-mailbox results." })
	async googleViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("google")
	@AllowAnonymous()
	@ApiExcludeEndpoint()
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

	@Post("backfill/gmail")
	@AllowAnonymous()
	@ApiExcludeEndpoint()
	async backfillGmail(
		@Req() request: Request,
		@Headers("authorization") authorization?: string,
	) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the Gmail backfill.",
			});
			throw new ServiceUnavailableException("Backfill is not configured.");
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		const input = gmailBackfillInput.safeParse(request.body);
		if (!input.success) {
			throw new BadRequestException(input.error.issues);
		}

		return this.google.backfillGmail(input.data);
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
