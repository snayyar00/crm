import { Module } from "@nestjs/common";
import { CurrencyModule } from "../currency/currency.module";
import { FieldsModule } from "../fields/fields.module";
import { TrpcModule } from "../trpc/trpc.module";
import { DealsRouter } from "./deals.router";
import { ObligationsService } from "../obligations/obligations.service";
import { DealsService } from "./deals.service";

@Module({
	imports: [FieldsModule, TrpcModule, CurrencyModule],
	providers: [ObligationsService, DealsService, DealsRouter],
	exports: [DealsService],
})
export class DealsModule {}
