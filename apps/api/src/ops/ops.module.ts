import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { OpsRouter } from "./ops.router";
import { OpsService } from "./ops.service";

@Module({
	imports: [TrpcModule],
	providers: [OpsService, OpsRouter],
	exports: [OpsService],
})
export class OpsModule {}
