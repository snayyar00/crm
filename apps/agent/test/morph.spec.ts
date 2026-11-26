import { describe, expect, it } from "bun:test";
import {
	MORPH_CONTEXT_WINDOW_TOKENS,
	MORPH_MODEL_ID,
	morphModelFrom,
	morphStep,
	morphStepHandler,
} from "../agent/lib/morph";
import { MORPH } from "../agent/lib/morph-config";

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
	const fallback = async () => ({
		model: "deepseek/deepseek-v4-flash",
		modelContextWindowTokens: 1_000_000,
	});

	it("is a handler even when the key is absent (the build-time env)", () => {
		expect(typeof morphStepHandler(fallback, {})).toBe("function");
	});

	const ctxFor = (id: string, model: string | null) => ({
		session: { id },
		model: model ? { id: model } : null,
	});

	it("reads the key when a step starts, not when the agent module loads", async () => {
		const env: Record<string, string | undefined> = {};
		const step = morphStepHandler(fallback, env);
		env.MORPH_API_KEY = "test-key";
		const selection = await step(
			undefined,
			ctxFor("s1", "deepseek/deepseek-v4-flash"),
		);
		expect(typeof selection.model === "object" && selection.model.modelId).toBe(
			MORPH_MODEL_ID,
		);
	});

	it("without a key, every step keeps the session's model and context window", async () => {
		const step = morphStepHandler(fallback, {});
		const ctx = ctxFor("s2", "deepseek/deepseek-v4-flash");
		const first = await step(undefined, ctx);
		const second = await step(undefined, ctx);
		expect(first).toEqual({
			model: "deepseek/deepseek-v4-flash",
			modelContextWindowTokens: 1_000_000,
		});
		expect(second).toEqual(first);
	});

	it("without a key, a settings change after a session starts does not move it", async () => {
		let setting = {
			model: "deepseek/deepseek-v4-flash",
			modelContextWindowTokens: 1_000_000,
		};
		let reads = 0;
		const settings = async () => {
			reads++;
			return setting;
		};
		const step = morphStepHandler(settings, {});
		const ctx = ctxFor("s3", "deepseek/deepseek-v4-flash");
		await step(undefined, ctx);
		setting = { model: "openai/gpt-5.5", modelContextWindowTokens: 400_000 };
		const later = await step(undefined, ctx);
		expect(later).toEqual({
			model: "deepseek/deepseek-v4-flash",
			modelContextWindowTokens: 1_000_000,
		});
		expect(reads).toBe(1);
	});

	it("without a key, a session whose model no longer matches settings keeps its own model", async () => {
		const step = morphStepHandler(fallback, {});
		const selection = await step(
			undefined,
			ctxFor("s4", "deepseek/deepseek-v4-pro"),
		);
		expect(selection).toEqual({ model: "deepseek/deepseek-v4-pro" });
	});

	it("without a key or a session model, the step asks the session handler", async () => {
		const step = morphStepHandler(fallback, {});
		const selection = await step(undefined, ctxFor("s5", null));
		expect(selection.model).toBe("deepseek/deepseek-v4-flash");
	});

	it("keeps a bounded number of sessions: the oldest is read again", async () => {
		let reads = 0;
		const step = morphStepHandler(async () => {
			reads++;
			return fallback();
		}, {});
		const model = "deepseek/deepseek-v4-flash";
		for (let i = 0; i <= MORPH.sessionSelectionsKept; i++) {
			await step(undefined, ctxFor(`b${i}`, model));
		}
		expect(reads).toBe(MORPH.sessionSelectionsKept + 1);
		await step(undefined, ctxFor(`b${MORPH.sessionSelectionsKept}`, model));
		expect(reads).toBe(MORPH.sessionSelectionsKept + 1);
		await step(undefined, ctxFor("b0", model));
		expect(reads).toBe(MORPH.sessionSelectionsKept + 2);
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
