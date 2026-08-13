import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { ObligationsModule } from "../obligations/obligations.module";
import { CommitmentExtractorService } from "./commitment-extractor.service";
import { MailboxApiClient } from "./mailbox-api.client";
import { MailboxMatchService } from "./mailbox-match.service";
import { MailboxTokenService } from "./mailbox-token.service";
import { SyncStateService } from "./sync-state.service";
import { ThreadWriterService } from "./thread-writer.service";

@Module({
	imports: [AgentModule, CompaniesModule, ObligationsModule],
	providers: [
		CommitmentExtractorService,
		MailboxApiClient,
		MailboxTokenService,
		MailboxMatchService,
		SyncStateService,
		ThreadWriterService,
	],
	exports: [
		CommitmentExtractorService,
		MailboxApiClient,
		MailboxTokenService,
		MailboxMatchService,
		SyncStateService,
		ThreadWriterService,
	],
})
export class MailboxModule {}
