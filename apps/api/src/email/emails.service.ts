import { InjectDatabase } from "../database/database.constants";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Db } from "@crm/db";
import type { EmailDraftInput } from "./emails.contracts";

@Injectable()
export class EmailsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/** Always lands as DRAFT. Releasing is a separate, deliberate act. */
	async draft(input: EmailDraftInput, userId: string) {
		return this.db.emailJob.create({
			data: {
				to: input.to,
				cc: input.cc ?? [],
				subject: input.subject,
				body: input.body,
				attachments: input.attachments ?? undefined,
				dueAt: input.dueAt ? new Date(input.dueAt) : null,
				dealId: input.dealId,
				contactId: input.contactId,
				companyId: input.companyId,
				createdById: userId,
				status: "DRAFT",
			},
		});
	}

	/** The approval gate: a human moves DRAFT -> QUEUED and nothing else can. */
	async release(id: string) {
		const job = await this.db.emailJob.findUnique({ where: { id } });
		if (!job) throw new NotFoundException("No such email.");
		if (job.status !== "DRAFT") {
			throw new BadRequestException(`Only a draft can be released — this one is ${job.status}.`);
		}
		return this.db.emailJob.update({ where: { id }, data: { status: "QUEUED" } });
	}

	async cancel(id: string) {
		const job = await this.db.emailJob.findUnique({ where: { id } });
		if (!job) throw new NotFoundException("No such email.");
		if (job.status === "SENT") throw new BadRequestException("That one has already gone out.");
		return this.db.emailJob.update({ where: { id }, data: { status: "CANCELLED" } });
	}

	async list(status: string | undefined, limit: number) {
		return this.db.emailJob.findMany({
			where: status ? { status: status as never } : undefined,
			orderBy: { createdAt: "desc" },
			take: limit,
		});
	}
}
