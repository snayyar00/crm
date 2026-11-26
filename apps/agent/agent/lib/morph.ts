import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";

/**
 * Morph Ultra: a flat monthly plan, so agent steps on it cost nothing per token.
 * With MORPH_API_KEY set, every model step runs here instead of the Vercel AI
 * Gateway. Without the key the agent keeps its gateway model (the settings page
 * choice, or the default).
 *
 * Only Ultra-plan model ids. Any other Morph model may bill per token.
 */
export const MORPH_BASE_URL = "https://api.morphllm.com/v1";
export const MORPH_MODEL_ID = "morph-dsv41flash-1017";
/** Kept low on purpose: compaction starts earlier, and no step can outgrow what Morph accepts. */
export const MORPH_CONTEXT_WINDOW_TOKENS = 128_000;

type Env = Record<string, string | undefined>;
type MorphModel = LanguageModelV4;

export interface MorphSelection {
	model: MorphModel;
	modelContextWindowTokens: number;
}

const cache = new Map<string, MorphModel>();

export function morphModelFrom(env: Env): MorphModel | null {
	const apiKey = env.MORPH_API_KEY?.trim();
	if (!apiKey) return null;

	let model = cache.get(apiKey);
	if (!model) {
		model = createOpenAICompatible({
			name: "morph",
			baseURL: MORPH_BASE_URL,
			apiKey,
		})(MORPH_MODEL_ID);
		cache.set(apiKey, model);
	}
	return model;
}

/**
 * A `step.started` selection. eve lets only that scope return a live model, and a
 * step selection wins over the session one, so Morph answers every step.
 */
export function morphStep(env: Env = process.env): MorphSelection | null {
	const model = morphModelFrom(env);
	return model
		? { model, modelContextWindowTokens: MORPH_CONTEXT_WINDOW_TOKENS }
		: null;
}

type StepContext = { readonly model: { readonly id: string } | null };

export function morphStepHandler<E, C, S>(
	fallback: (event: E, ctx: C) => S | Promise<S>,
	env: Env = process.env,
): (
	event: E,
	ctx: C & StepContext,
) => Promise<MorphSelection | { model: string } | S> {
	return async (event, ctx) =>
		morphStep(env) ??
		(ctx.model ? { model: ctx.model.id } : fallback(event, ctx));
}
