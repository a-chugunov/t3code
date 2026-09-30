import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
} from "@t3tools/client-runtime/state/thread-sort";

import { resolveThreadStatusPill } from "../components/Sidebar.logic";

export const AGENT_KEY_COUNT = 6;

/** One Agent Key's colour, in the pad's own vocabulary. */
export type AgentKeyState = "idle" | "working" | "attention" | "unread" | "error";

/**
 * Collapses the sidebar status into what a key can show. Amber means the
 * agent is blocked on you, green that it finished since you last looked.
 */
export function resolveAgentKeyState(
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
): AgentKeyState {
  const pill = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
  if (
    pill?.label === "Pending Approval" ||
    pill?.label === "Awaiting Input" ||
    pill?.label === "Plan Ready"
  ) {
    return "attention";
  }
  if (thread.session?.status === "error") return "error";
  switch (pill?.label) {
    case "Working":
    case "Connecting":
    case "Monitoring":
      return "working";
    case "Completed":
      return thread.latestTurn?.state === "error" ? "error" : "unread";
    default:
      return "idle";
  }
}

/**
 * Threads that can hold a key, in sidebar order: pinned, then active.
 * Snoozed, settled, and archived threads are put away, so they stay dark.
 */
export function rankAgentKeyThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  now: string,
): EnvironmentThreadShell[] {
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.settledOverride === "settled") continue;
    if (effectiveSnoozed(thread, { now })) continue;
    (thread.pinnedAt != null ? pinned : active).push(thread);
  }
  return [...sortPinnedThreadsByOrderKey(pinned), ...sortActiveThreadsByOrderKey(active)];
}

export function agentKeyThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/**
 * The keys show the first six ranked threads, but a thread keeps its key for
 * as long as it stays in that six, so a glance never has to re-learn the pad.
 * Only a thread entering the six moves, into the lowest free key.
 *
 * A thread missing from `known` has not loaded yet (or its environment is
 * offline), which is not the same as leaving: it keeps its key, dark, until a
 * visible thread needs that key.
 */
export function assignAgentKeys(
  previous: ReadonlyArray<string | null>,
  ranked: ReadonlyArray<string>,
  known: ReadonlySet<string>,
): Array<string | null> {
  const top = new Set(ranked.slice(0, AGENT_KEY_COUNT));
  const placed = new Set<string>();
  const keys = Array.from({ length: AGENT_KEY_COUNT }, (_, index) => {
    const threadKey = previous[index] ?? null;
    if (threadKey === null || placed.has(threadKey)) return null;
    if (!top.has(threadKey) && known.has(threadKey)) return null;
    placed.add(threadKey);
    return threadKey;
  });
  for (const threadKey of top) {
    if (placed.has(threadKey)) continue;
    let index = keys.indexOf(null);
    if (index === -1) index = keys.findIndex((held) => held !== null && !known.has(held));
    if (index === -1) break;
    keys[index] = threadKey;
  }
  return keys;
}
