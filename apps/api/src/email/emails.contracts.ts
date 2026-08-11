import { z } from "zod";

const attachment = z.object({
	name: z.string().trim().min(1),
	/** Base64. Keep these small — large files belong in blob storage. */
	content: z.string().min(1),
});

export const emailDraftInput = z.object({
	to: z.array(z.email()).min(1, "An email needs at least one recipient."),
	cc: z.array(z.email()).optional(),
	subject: z.string().trim().min(1, "An email needs a subject."),
	body: z.string().trim().min(1, "An email needs a body."),
	attachments: z.array(attachment).optional(),
	/** When to send. Omit to send on the next dispatcher tick after release. */
	dueAt: z.string().nullable().optional(),
	dealId: z.string().optional(),
	contactId: z.string().optional(),
	companyId: z.string().optional(),
});

export const emailIdInput = z.object({ id: z.string() });

export const emailListInput = z.object({
	status: z.enum(["DRAFT", "QUEUED", "SENDING", "SENT", "FAILED", "CANCELLED"]).optional(),
	limit: z.number().int().min(1).max(200).default(50),
});

export type EmailDraftInput = z.infer<typeof emailDraftInput>;
