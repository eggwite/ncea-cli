import * as p from "@clack/prompts";

export const PROMPT_CANCELLED = Symbol("PROMPT_CANCELLED");

export function wasPromptCancelled(value) {
	return value === PROMPT_CANCELLED;
}

export function unwrapPromptResult(
	value,
	cancelMessage = "Operation cancelled."
) {
	if (p.isCancel(value)) {
		p.cancel(cancelMessage);
		return PROMPT_CANCELLED;
	}
	return value;
}

export function createPrompt() {
	return {
		text: async (options, cancelMessage) =>
			unwrapPromptResult(await p.text(options), cancelMessage),
		select: async (options, cancelMessage) =>
			unwrapPromptResult(await p.select(options), cancelMessage),
		multiselect: async (options, cancelMessage) =>
			unwrapPromptResult(await p.multiselect(options), cancelMessage),
		confirm: async (options, cancelMessage) =>
			unwrapPromptResult(await p.confirm(options), cancelMessage),
	};
}
