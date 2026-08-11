import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { ObligationDigestService } from "./obligation-digest.service";
import { ObligationsRouter } from "./obligations.router";
import { ObligationsService } from "./obligations.service";

@Module({
	imports: [TrpcModule],
	providers: [ObligationsService, ObligationDigestService, ObligationsRouter],
	exports: [ObligationsService, ObligationDigestService],
})
export class ObligationsModule {}
