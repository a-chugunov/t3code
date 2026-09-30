import type {
  CodexMicroAgentKeyMode,
  CodexMicroAutoDimSeconds,
  CodexMicroDialMode,
  CodexMicroKeyAction,
  CodexMicroStickDirection,
} from "@t3tools/contracts";

import type { AgentKeyState } from "../../codexMicro/agentKeys";
import type { CodexMicroPadState } from "../../codexMicro/codexMicroStore";

export const CODEX_MICRO_KEY_ACTION_LABELS: Record<CodexMicroKeyAction, string> = {
  approve: "Approve",
  decline: "Decline",
  send: "Send",
  stop: "Stop",
  "fast-mode": "Fast mode",
  "insert-text": "Insert text",
  "new-thread": "New thread",
  "previous-thread": "Previous thread",
  "next-thread": "Next thread",
  "open-attention": "Open what needs you",
  "command-palette": "Command palette",
  "toggle-sidebar": "Toggle sidebar",
  back: "Back",
  forward: "Forward",
  none: "Unassigned",
};

/** The action menu's sections, in order. `insert-text` only makes sense on a key. */
export const CODEX_MICRO_ACTION_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly actions: ReadonlyArray<CodexMicroKeyAction>;
}> = [
  {
    label: "Open thread",
    actions: ["approve", "decline", "send", "stop", "fast-mode", "insert-text"],
  },
  { label: "Threads", actions: ["new-thread", "previous-thread", "next-thread", "open-attention"] },
  { label: "App", actions: ["command-palette", "toggle-sidebar", "back", "forward"] },
];

export const CODEX_MICRO_AGENT_KEY_MODE_LABELS: Record<CodexMicroAgentKeyMode, string> = {
  inbox: "Pinned and active threads",
  pinned: "Pinned threads",
  custom: "Threads you choose",
};

export const CODEX_MICRO_DIAL_MODE_LABELS: Record<CodexMicroDialMode, string> = {
  threads: "Move between threads",
  scroll: "Scroll the conversation",
};

export const CODEX_MICRO_STICK_DIRECTION_LABELS: Record<CodexMicroStickDirection, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

/** What a key's picture says: its action, or the text it types. */
export function codexMicroKeyLabel(action: CodexMicroKeyAction, text: string | undefined): string {
  if (action === "insert-text" && text) return `“${text}”`;
  return CODEX_MICRO_KEY_ACTION_LABELS[action];
}

export const CODEX_MICRO_AUTO_DIM_LABELS: Record<CodexMicroAutoDimSeconds, string> = {
  0: "Never",
  30: "After 30 seconds",
  60: "After 1 minute",
  180: "After 3 minutes",
  600: "After 10 minutes",
  1800: "After 30 minutes",
  3600: "After 1 hour",
};

export const AGENT_KEY_STATE_LABELS: Record<AgentKeyState, string> = {
  idle: "Idle",
  working: "Working",
  attention: "Needs you",
  unread: "Finished",
  error: "Failed",
};

/** One line under the switch saying where the pad is and what to do next. */
export function codexMicroStatusLabel(
  pad: CodexMicroPadState,
  environment: { readonly desktop: boolean; readonly mac: boolean },
): string | undefined {
  switch (pad.status) {
    case "off":
      return undefined;
    case "unsupported":
      return "This browser can't reach the pad. Use the desktop app, or Chrome or Edge.";
    case "elsewhere":
      return "Another T3 Code window is using the pad.";
    case "searching":
      return environment.desktop
        ? "Plug in Codex Micro, or pair it over Bluetooth."
        : "Connect Codex Micro to use it in this browser.";
    case "blocked":
      return environment.desktop && environment.mac
        ? "macOS blocked the pad. Allow T3 Code in Input Monitoring, then reopen T3 Code."
        : `Couldn't open the pad: ${pad.message}`;
    case "connecting":
      return "Connecting…";
    case "unresponsive":
      if (!pad.writesRefused) return "The pad isn't answering. Unplug it and plug it back in.";
      return environment.desktop && environment.mac
        ? "macOS is blocking the pad, usually because the screen is locked. It relights when you unlock."
        : "The system is refusing to send anything to the pad.";
    case "connected": {
      const link = pad.transport === "bluetooth" ? "Bluetooth" : "USB";
      const battery = `${Math.round(pad.padStatus.battery)}% battery${pad.padStatus.is_charging ? ", charging" : ""}`;
      return `Connected over ${link} · ${battery} · Firmware ${pad.padStatus.version}`;
    }
  }
}
