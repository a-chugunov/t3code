import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentKeyThreadKey,
  assignAgentKeys,
  rankAgentKeyThreads,
  resolveAgentKeyState,
} from "./agentKeys";

const environmentId = EnvironmentId.make("environment-local");
const NOW = "2026-09-30T12:00:00.000Z";

function thread(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId,
    projectId: ProjectId.make("project-1"),
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function session(status: OrchestrationSessionStatus): EnvironmentThreadShell["session"] {
  return {
    threadId: ThreadId.make("session-thread"),
    status,
    providerName: "codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  };
}

function completedTurn(state: "completed" | "error"): EnvironmentThreadShell["latestTurn"] {
  return {
    turnId: TurnId.make("turn-1"),
    state,
    requestedAt: "2026-09-30T11:00:00.000Z",
    startedAt: "2026-09-30T11:00:00.000Z",
    completedAt: "2026-09-30T11:30:00.000Z",
    assistantMessageId: null,
  };
}

const known = (...keys: string[]) => new Set(keys);

describe("assignAgentKeys", () => {
  it("fills keys left to right on first run", () => {
    expect(assignAgentKeys([], ["a", "b", "c"], known("a", "b", "c"))).toEqual([
      "a",
      "b",
      "c",
      null,
      null,
      null,
    ]);
  });

  it("keeps each thread on its key when the order changes", () => {
    const all = known("a", "b", "c", "d");
    const keys = assignAgentKeys([], ["a", "b", "c", "d"], all);
    expect(assignAgentKeys(keys, ["d", "c", "b", "a"], all)).toEqual(keys);
  });

  it("puts a thread entering the top six on the key its displaced thread freed", () => {
    const all = known("a", "b", "c", "d", "e", "f", "new");
    const keys = assignAgentKeys([], ["a", "b", "c", "d", "e", "f"], all);
    // A new thread leads the list and pushes "f" out of the six.
    expect(assignAgentKeys(keys, ["new", "a", "b", "c", "d", "e", "f"], all)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "new",
    ]);
  });

  it("darkens a key whose thread was put away, without moving the others", () => {
    expect(
      assignAgentKeys(["a", "b", "c", null, null, null], ["a", "c"], known("a", "b", "c")),
    ).toEqual(["a", null, "c", null, null, null]);
  });

  it("holds the keys of threads that have not loaded yet", () => {
    const stored = ["a", "b", "c", null, null, null];
    // Right after launch nothing has loaded: nothing moves.
    expect(assignAgentKeys(stored, [], known())).toEqual(stored);
    // One environment arrives first; the rest keep their keys.
    expect(assignAgentKeys(stored, ["c"], known("c"))).toEqual(stored);
  });

  it("hands an unloaded thread's key to a visible newcomer only when no key is free", () => {
    const stored = ["a", "b", "c", "d", "e", "gone"];
    expect(
      assignAgentKeys(
        stored,
        ["a", "b", "c", "d", "e", "new"],
        known("a", "b", "c", "d", "e", "new"),
      ),
    ).toEqual(["a", "b", "c", "d", "e", "new"]);
  });

  it("repairs a stored assignment that lists a thread twice", () => {
    expect(
      assignAgentKeys(["a", "a", null, null, null, null], ["a", "b"], known("a", "b")),
    ).toEqual(["a", "b", null, null, null, null]);
  });
});

describe("rankAgentKeyThreads", () => {
  it("orders pinned threads first and skips put-away threads", () => {
    const ranked = rankAgentKeyThreads(
      [
        thread("active-old", { createdAt: "2026-09-30T09:00:00.000Z" }),
        thread("active-new", { createdAt: "2026-09-30T11:00:00.000Z" }),
        thread("pinned", { pinnedAt: "2026-09-30T08:00:00.000Z" }),
        thread("archived", { archivedAt: NOW }),
        thread("settled", { settledOverride: "settled", settledAt: NOW }),
        thread("snoozed", {
          snoozedAt: NOW,
          snoozedUntil: "2026-09-30T18:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["pinned", "active-new", "active-old"]);
  });

  it("brings a thread back once its snooze has passed", () => {
    const woke = thread("woke", { snoozedAt: NOW, snoozedUntil: "2026-09-30T11:00:00.000Z" });
    expect(rankAgentKeyThreads([woke], NOW).map(agentKeyThreadKey)).toEqual([
      agentKeyThreadKey(woke),
    ]);
  });
});

describe("resolveAgentKeyState", () => {
  it("turns amber when the agent waits on you", () => {
    expect(resolveAgentKeyState(thread("t", { hasPendingApprovals: true }), undefined)).toBe(
      "attention",
    );
    expect(resolveAgentKeyState(thread("t", { hasPendingUserInput: true }), undefined)).toBe(
      "attention",
    );
  });

  it("shows work, failure, and idle", () => {
    expect(resolveAgentKeyState(thread("t", { session: session("running") }), undefined)).toBe(
      "working",
    );
    expect(resolveAgentKeyState(thread("t", { backgroundLiveness: "working" }), undefined)).toBe(
      "working",
    );
    expect(resolveAgentKeyState(thread("t", { session: session("error") }), undefined)).toBe(
      "error",
    );
    expect(resolveAgentKeyState(thread("t", { session: session("ready") }), undefined)).toBe(
      "idle",
    );
  });

  it("stays green only until the thread is visited", () => {
    const finished = thread("t", { latestTurn: completedTurn("completed") });
    expect(resolveAgentKeyState(finished, "2026-09-30T11:10:00.000Z")).toBe("unread");
    expect(resolveAgentKeyState(finished, "2026-09-30T11:40:00.000Z")).toBe("idle");
  });

  it("shows an unseen failed turn as red", () => {
    const failed = thread("t", { latestTurn: completedTurn("error") });
    expect(resolveAgentKeyState(failed, "2026-09-30T11:10:00.000Z")).toBe("error");
  });
});
