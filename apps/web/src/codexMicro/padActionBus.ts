import type { CodexMicroKeyAction } from "@t3tools/contracts";

/**
 * Typed window-event bus from the Codex Micro to the views that own each
 * action: ChatView answers for the open thread, the chat route starts new
 * threads. Dispatch is synchronous, so the pad learns whether anyone acted.
 */
export type PadAction = Exclude<CodexMicroKeyAction, "none">;

/** What happened, so the pad can say why a press did nothing. */
export type PadActionOutcome = "done" | "fast-mode-on" | "fast-mode-off" | "unavailable";

interface PadActionRequest {
  readonly action: PadAction;
  outcome: PadActionOutcome | null;
}

const EVENT_NAME = "t3code:codex-micro-action";

/** Returns null when no mounted view handles the action. */
export function dispatchPadAction(action: PadAction): PadActionOutcome | null {
  const request: PadActionRequest = { action, outcome: null };
  window.dispatchEvent(new CustomEvent<PadActionRequest>(EVENT_NAME, { detail: request }));
  return request.outcome;
}

/** The listener returns null for actions it does not own. */
export function subscribePadActions(
  listener: (action: PadAction) => PadActionOutcome | null,
): () => void {
  const handler = (event: Event) => {
    const request = (event as CustomEvent<PadActionRequest>).detail;
    if (request.outcome !== null) return;
    request.outcome = listener(request.action);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
