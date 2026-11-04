const SECOND_MS = 1_000;

export const DOCUMENT = {
	build: {
		python: "python3",
		workspaceDir: "agent/subagents/document_agent/sandbox/workspace",
		timeoutMs: 90 * SECOND_MS,
		maxOutputBytes: 1024 * 1024,
	},
} as const;
