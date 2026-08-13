import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import tool from "./agent/subagents/document_agent/tools/generate_sow";

const WS = resolve(import.meta.dir, "agent/subagents/document_agent/sandbox/workspace");

const ctx = {
  async getSandbox() {
    return {
      resolvePath: (p: string) => join(WS, p),
      async writeTextFile({ path, content }: { path: string; content: string }) {
        writeFileSync(path, content);
      },
      async run({ command }: { command: string }) {
        try {
          const stdout = execSync(command, { cwd: WS, encoding: "utf8", timeout: 90000 });
          return { exitCode: 0, stdout, stderr: "" };
        } catch (e: any) {
          return { exitCode: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
        }
      },
    };
  },
};

const dealId = process.argv[2] ?? "b4e259de-4446-4f75-bfaa-dcdf6dc9210f";
const result = await (tool as any).execute({ dealId }, ctx);
const { config, ...rest } = result;
console.log(JSON.stringify(rest, null, 2));
if (config) console.log("FEE:", config.fee.amount, "| CONTACT:", config.client.contact_name, "| TITLE:", config.engagement_title);
process.exit(0);
