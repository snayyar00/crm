import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	obligationDueInput,
	obligationStartTrialInput,
} from "./obligations.contracts";
import { ObligationsService } from "./obligations.service";

/**
 * The compliance calendar's read/write surface.
 *
 * Why a router at all, when the daily alarm already reads `due()` internally:
 * the alarm can only report clocks that EXIST, and the one kind nothing can
 * infer is TRIAL_EXPIRY. Trials are provisioned by hand elsewhere. Without a
 * way in, `spawnForTrial` stays a method with no caller and a trial lapses
 * unannounced — which is exactly the failure this whole module was built to
 * stop.
 *
 * The realistic caller is not a form. It is an agent over the crm-api skill,
 * because "tell Claude the trial is provisioned" rides a habit that already
 * exists, where "remember to fill in the trial field" is the habit that never
 * forms.
 */
@Router({ alias: "obligations" })
@UseMiddlewares(AuthMiddleware)
export class ObligationsRouter {
	constructor(
		@Inject(ObligationsService) private readonly obligations: ObligationsService,
	) {}

	/** Everything due or overdue inside the window, soonest first. */
	@Query({ input: obligationDueInput })
	async due(@Input() input: z.infer<typeof obligationDueInput>) {
		return this.obligations.due(input.withinDays);
	}

	/**
	 * Idempotent by construction — `ensure()` returns `{ row, created }`, so
	 * calling this twice for the same trial updates the clock rather than
	 * minting a duplicate. `created` is returned unchanged so the caller can
	 * tell which happened instead of inferring it from a timestamp.
	 */
	@Mutation({ input: obligationStartTrialInput })
	async startTrial(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof obligationStartTrialInput>,
	) {
		return this.obligations.spawnForTrial({
			...input,
			createdById: ctx.user.id,
		});
	}
}
