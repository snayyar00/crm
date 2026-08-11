import { Module } from "@nestjs/common";
import { ObligationsModule } from "../obligations/obligations.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ActivitiesRouter } from "./activities.router";
import { ActivitiesService } from "./activities.service";

@Module({
	imports: [TrpcModule, ObligationsModule],
	providers: [ActivitiesService, ActivitiesRouter],
	exports: [ActivitiesService],
})
export class ActivitiesModule {}
