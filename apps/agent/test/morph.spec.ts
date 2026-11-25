import { describe, expect, it } from "bun:test";
import {
	MORPH_CONTEXT_WINDOW_TOKENS,
	MORPH_MODEL_ID,
	morphModelFrom,
	morphStep,
	morphStepEvents,
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

describe("morphStepEvents", () => {
	it("adds a step handler only when the key is set", () => {
		expect(morphStepEvents({})).toEqual({});
		const events = morphStepEvents({ MORPH_API_KEY: "test-key" });
		expect(events["step.started"]?.().model.modelId).toBe(MORPH_MODEL_ID);
	});
});
