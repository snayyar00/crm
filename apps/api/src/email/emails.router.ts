import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { emailDraftInput, emailIdInput, emailListInput } from "./emails.contracts";
import { EmailsService } from "./emails.service";

@Router({ alias: "emails" })
@UseMiddlewares(AuthMiddleware)
export class EmailsRouter {
	constructor(@Inject(EmailsService) private readonly emails: EmailsService) {}

	@Query({ input: emailListInput })
	async list(@Input() input: z.infer<typeof emailListInput>) {
		return this.emails.list(input.status, input.limit);
	}

	@Mutation({ input: emailDraftInput })
	async draft(@Ctx() ctx: AuthedTrpcContext, @Input() input: z.infer<typeof emailDraftInput>) {
		return this.emails.draft(input, ctx.user.id);
	}

	@Mutation({ input: emailIdInput })
	async release(@Input("id") id: string) {
		return this.emails.release(id);
	}

	@Mutation({ input: emailIdInput })
	async cancel(@Input("id") id: string) {
		return this.emails.cancel(id);
	}
}
