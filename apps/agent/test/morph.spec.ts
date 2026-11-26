import { describe, expect, it } from "bun:test";
import {
	MORPH_CONTEXT_WINDOW_TOKENS,
	MORPH_MODEL_ID,
	morphModelFrom,
	morphStep,
	morphStepHandler,
} from "../agent/lib/morph";

describe("morphModelFrom", () => {
	it("is null without a Morph key, so the agent keeps its gateway model", () => {
		expect(morphModelFrom({})).toBeNull();
		expect(morphModelFrom({ MORPH_API_KEY: "   " })).toBeNull();
	});

	it("is the Ultra-plan DeepSeek model on Morph when the key is set", () => {
		const model = morphModelFrom({ MORPH_API_KEY: "test-key" });
		expect(model).not.toBeNull();
		expect(model?.modelId).toBe(MORPH_MODEL_ID);
		expect(model?.provider).toStartWith("morph");
	});
});

describe("morphStep", () => {
	it("selects Morph for every step, with its own context window", () => {
		const selection = morphStep({ MORPH_API_KEY: "test-key" });
		expect(selection?.model.modelId).toBe(MORPH_MODEL_ID);
		expect(selection?.modelContextWindowTokens).toBe(
			MORPH_CONTEXT_WINDOW_TOKENS,
		);
	});

	it("leaves the step unset without a key", () => {
		expect(morphStep({})).toBeNull();
	});
});

describe("morphStepHandler", () => {
	// eve compiles each agent's model event names at build time (eve build), and
	// only dispatches the compiled ones. The image is built without MORPH_API_KEY
	// (it is a runtime env var), so a handler added only "when the key is set" was
	// never compiled and every step went to the Vercel gateway (prod, 2026-11-25:
	// crm-agent step "in 9.5k out 405" = gateway row 9.5K input / 405 output).
	const fallback = async () => ({
		model: "deepseek/deepseek-v4-flash",
		modelContextWindowTokens: 1_000_000,
	});

	it("is a handler even when the key is absent (the build-time env)", () => {
		expect(typeof morphStepHandler(fallback, {})).toBe("function");
	});

	it("reads the key when a step starts, not when the agent module loads", async () => {
		const env: Record<string, string | undefined> = {};
		const step = morphStepHandler(fallback, env);
		env.MORPH_API_KEY = "test-key";
		const selection = await step(undefined, undefined);
		expect(typeof selection.model === "object" && selection.model.modelId).toBe(
			MORPH_MODEL_ID,
		);
	});

	it("without a key at step time, the step keeps the session's own selection", async () => {
		const step = morphStepHandler(fallback, {});
		const selection = await step(undefined, undefined);
		expect(selection.model).toBe("deepseek/deepseek-v4-flash");
	});
});

describe("every agent registers the Morph step handler unconditionally", () => {
	const files = [
		"agent/agent.ts",
		"agent/subagents/agent_builder/agent.ts",
		"agent/subagents/agent_runner/agent.ts",
		"agent/subagents/document_agent/agent.ts",
	];
	for (const file of files) {
		it(file, async () => {
			const src = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
			expect(src).toMatch(/"step\.started":\s*morphStepHandler\(/);
			expect(src).not.toContain("...morphStepEvents(");
		});
	}
});
