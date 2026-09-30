import type { CodexMicroAutoDimSeconds, CodexMicroKeyAction } from "@t3tools/contracts";

import type { AgentKeyState } from "../../codexMicro/agentKeys";
import type { CodexMicroPadState } from "../../codexMicro/codexMicroStore";

export const CODEX_MICRO_KEY_ACTION_LABELS: Record<CodexMicroKeyAction, string> = {
  approve: "Approve",
  decline: "Decline",
  send: "Send",
  stop: "Stop",
  "fast-mode": "Fast mode",
  "new-thread": "New thread",
  none: "Unassigned",
};

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
