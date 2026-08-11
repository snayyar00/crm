import { Module } from "@nestjs/common";
import { ObligationDigestService } from "./obligation-digest.service";
import { ObligationsService } from "./obligations.service";

@Module({
	providers: [ObligationsService, ObligationDigestService],
	exports: [ObligationsService, ObligationDigestService],
})
export class ObligationsModule {}
