import { CODEX_MICRO_ACTION_KEYS, type CodexMicroActionKey } from "@t3tools/contracts";

import type { PadInputEvent } from "./protocol";

export type JoystickDirection = "up" | "down" | "left" | "right";

export type PadGesture =
  | { readonly kind: "agent-key"; readonly index: number; readonly doubleTap: boolean }
  | { readonly kind: "action-key"; readonly key: CodexMicroActionKey }
  /** One dial detent: 1 clockwise, -1 counter-clockwise. */
  | { readonly kind: "dial-turn"; readonly step: 1 | -1 }
  | { readonly kind: "dial-press" }
  | { readonly kind: "dial-hold" }
  | { readonly kind: "joystick"; readonly direction: JoystickDirection };

// Factory timings and thresholds, so the pad feels the same as with the ChatGPT app.
const DOUBLE_TAP_MS = 350;
const DIAL_HOLD_MS = 500;
const JOYSTICK_TRIGGER_DISTANCE = 0.5;
const JOYSTICK_REARM_DISTANCE = 0.1;

const ACTION_KEYS: ReadonlySet<string> = new Set(CODEX_MICRO_ACTION_KEYS);
const isActionKey = (key: string): key is CodexMicroActionKey => ACTION_KEYS.has(key);

/** Angle runs 0-1 in turns; each direction is a quarter, with right catching the rest. */
export function joystickDirection(angle: number): JoystickDirection {
  if (angle >= 0.625 && angle < 0.875) return "up";
  if (angle >= 0.125 && angle < 0.375) return "down";
  if (angle >= 0.375 && angle < 0.625) return "left";
  return "right";
}

/**
 * Turns raw pad events into gestures. Keys act on press; the dial button acts
 * on release so a long hold can mean something else; the thumbstick fires once
 * per push and must return to centre before it fires again.
 */
export class PadGestureReader {
  private lastAgentTap: { readonly index: number; readonly at: number } | null = null;
  private dialDownAt: number | null = null;
  private joystickArmed = true;

  read(event: PadInputEvent, now: number): PadGesture | null {
    if (event.type === "joystick") {
      if (event.distance <= JOYSTICK_REARM_DISTANCE) {
        this.joystickArmed = true;
        return null;
      }
      if (!this.joystickArmed || event.distance < JOYSTICK_TRIGGER_DISTANCE) return null;
      this.joystickArmed = false;
      return { kind: "joystick", direction: joystickDirection(event.angle) };
    }

    if (event.phase === "tick") {
      return { kind: "dial-turn", step: event.key === "ENC_CW" ? 1 : -1 };
    }
    if (event.key === "ENC_CLK") {
      if (event.phase === "down") {
        this.dialDownAt = now;
        return null;
      }
      const downAt = this.dialDownAt;
      this.dialDownAt = null;
      if (downAt === null) return null;
      return now - downAt >= DIAL_HOLD_MS ? { kind: "dial-hold" } : { kind: "dial-press" };
    }
    if (event.phase !== "down") return null;

    const agentKey = /^AG0([0-5])$/.exec(event.key);
    if (agentKey) {
      const index = Number(agentKey[1]);
      const last = this.lastAgentTap;
      const doubleTap = last !== null && last.index === index && now - last.at < DOUBLE_TAP_MS;
      this.lastAgentTap = doubleTap ? null : { index, at: now };
      return { kind: "agent-key", index, doubleTap };
    }
    // ACT11 is the second switch under the wide keycap; ACT10 already reports the press.
    return isActionKey(event.key) ? { kind: "action-key", key: event.key } : null;
  }
}
