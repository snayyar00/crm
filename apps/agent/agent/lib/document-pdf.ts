import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { SandboxSession } from "eve/sandbox";
import { DOCUMENT } from "./document-config";

const run = promisify(execFile);

export type PdfBuild =
	| { ok: true; pdfPath: string; pdfBytes: number; stdout: string }
	| { ok: false; error: string; stderr: string; stdout: string };

export async function buildPdfIntoSandbox(input: {
	sandbox: SandboxSession;
	script: "build_sow.py" | "build_doc.py";
	config: unknown;
	sandboxFile: string;
}): Promise<PdfBuild> {
	const workspace = resolve(process.cwd(), DOCUMENT.build.workspaceDir);
	const dir = await mkdtemp(join(tmpdir(), "crm-doc-"));
	try {
		const configPath = join(dir, "config.json");
		const outputPath = join(dir, basename(input.sandboxFile));
		await writeFile(configPath, JSON.stringify(input.config, null, 2));

		let stdout = "";
		try {
			const result = await run(
				DOCUMENT.build.python,
				[input.script, configPath, outputPath],
				{
					cwd: workspace,
					timeout: DOCUMENT.build.timeoutMs,
					maxBuffer: DOCUMENT.build.maxOutputBytes,
				},
			);
			stdout = result.stdout;
		} catch (error) {
			const failed = error as {
				stdout?: string;
				stderr?: string;
				message: string;
			};
			return {
				ok: false,
				error: "PDF generation failed",
				stderr: failed.stderr || failed.message,
				stdout: failed.stdout ?? "",
			};
		}

		const bytes = new Uint8Array(await readFile(outputPath));
		const pdfPath = input.sandbox.resolvePath(input.sandboxFile);
		await input.sandbox.writeBinaryFile({ path: pdfPath, content: bytes });
		return { ok: true, pdfPath, pdfBytes: bytes.byteLength, stdout };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
