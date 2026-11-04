import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildPdfIntoSandbox } from "../../../lib/document-pdf";

const blockSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("p"), text: z.string() }),
	z.object({ type: z.literal("callout"), paras: z.array(z.string()).min(1) }),
	z.object({ type: z.literal("bullets"), items: z.array(z.string()).min(1) }),
	z.object({ type: z.literal("numbers"), items: z.array(z.string()).min(1) }),
	z.object({ type: z.literal("kicker"), text: z.string() }),
	z.object({
		type: z.literal("table"),
		headers: z.array(z.string()).min(1),
		rows: z.array(z.array(z.string())).min(1),
	}),
	z.object({
		type: z.literal("banner"),
		big: z.string(),
		label: z.string().optional(),
		note: z.string().optional(),
	}),
]);

export default defineTool({
	description:
		"Generate ANY branded WebAbility document (proposal, one-pager, guide, report summary, invoice cover) as a tagged accessible PDF in the signed-SOW brand: navy cover, numbered sections, tables, callouts, fee banner. Compose the content as sections of typed blocks. For Statements of Work specifically, use generate_sow instead — it derives content from the deal.",
	inputSchema: z.object({
		title: z.string().describe("Document title (cover + PDF title)"),
		titleAccent: z
			.string()
			.optional()
			.describe("Optional blue second title line, e.g. the client name"),
		subtitle: z
			.string()
			.optional()
			.describe("One-line descriptor under the title"),
		docType: z
			.string()
			.default("Document")
			.describe('Header label, e.g. "Proposal", "Guide", "Report"'),
		reference: z
			.string()
			.optional()
			.describe('Reference code, e.g. "PROP-2026-0042"'),
		date: z.string().optional().describe('Issue date, e.g. "August 13, 2026"'),
		preparedFor: z.string().optional(),
		preparedBy: z.string().default("WebAbility.io · Sidharth Nayyar, Founder"),
		cover: z
			.boolean()
			.default(true)
			.describe("false = skip the navy cover page"),
		filename: z
			.string()
			.regex(/^[A-Za-z0-9._-]+\.pdf$/)
			.describe('Output filename, e.g. "Acme-Proposal.pdf"'),
		sections: z
			.array(
				z.object({
					heading: z.string(),
					blocks: z.array(blockSchema).min(1),
				}),
			)
			.min(1),
	}),
	async execute(input, ctx) {
		const spec = {
			title: input.title,
			title_accent: input.titleAccent,
			subtitle: input.subtitle,
			doc_type: input.docType,
			reference: input.reference,
			date: input.date,
			month_year: input.date
				? new Date(input.date).toLocaleDateString("en-US", {
						month: "long",
						year: "numeric",
					})
				: undefined,
			prepared_for: input.preparedFor,
			prepared_by: input.preparedBy,
			cover: input.cover,
			sections: input.sections,
		};

		const built = await buildPdfIntoSandbox({
			sandbox: await ctx.getSandbox(),
			script: "build_doc.py",
			config: spec,
			sandboxFile: input.filename,
		});

		if (!built.ok) {
			return {
				error: built.error,
				stderr: built.stderr,
				stdout: built.stdout,
			};
		}

		return {
			pdf_path: built.pdfPath,
			pdf_bytes: built.pdfBytes,
			title: input.title,
		};
	},
});
