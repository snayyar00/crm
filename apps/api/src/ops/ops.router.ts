import { Inject } from "@nestjs/common";
import { Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { OpsService } from "./ops.service";

@Router({ alias: "ops" })
@UseMiddlewares(AuthMiddleware)
export class OpsRouter {
	constructor(@Inject(OpsService) private readonly ops: OpsService) {}

	@Query()
	async crons() {
		return this.ops.crons();
	}
}
