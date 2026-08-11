import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { GoogleModule } from "../google/google.module";
import { MailboxModule } from "../mailbox/mailbox.module";
import { MicrosoftModule } from "../microsoft/microsoft.module";
import { MailboxSyncService } from "./mailbox-sync.service";
import { SyncController } from "./sync.controller";

@Module({
	imports: [EmailModule, MailboxModule, GoogleModule, MicrosoftModule],
	controllers: [SyncController],
	providers: [MailboxSyncService],
	exports: [MailboxSyncService],
})
export class SyncModule {}
