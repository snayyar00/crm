import { Module } from "@nestjs/common";
import { EmailDispatchService } from "./email-dispatch.service";
import { EmailsRouter } from "./emails.router";
import { EmailsService } from "./emails.service";

@Module({
	providers: [EmailsService, EmailsRouter, EmailDispatchService],
	exports: [EmailsService, EmailDispatchService],
})
export class EmailModule {}
