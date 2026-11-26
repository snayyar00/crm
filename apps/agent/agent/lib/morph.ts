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

/**
 * The `step.started` handler. Register it on every agent unconditionally: eve
 * compiles each agent's model event names at build time (eve build) and only
 * dispatches the compiled ones, and the image is built without MORPH_API_KEY.
 * So the key is read here, when each step starts. With it, Morph answers the
 * step; without it, the step keeps the agent's session selection (`fallback`,
 * the same function as its "session.started" handler), because eve fails the
 * turn when a model handler returns nothing.
 */
export function morphStepHandler<A extends unknown[], S>(
	fallback: (...args: A) => S | Promise<S>,
	env: Env = process.env,
): (...args: A) => Promise<MorphSelection | S> {
	return async (...args: A) => morphStep(env) ?? fallback(...args);
}
