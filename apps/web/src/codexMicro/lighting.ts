/**
 * What the pad shows, as the two payloads the firmware takes: `v.oai.thstatus`
 * colours each Agent Key, `v.oai.rgbcfg` drives the case glow (`ambient`) and
 * the backlight under the action keys (`keys`). Colours, effects, and timings
 * are the factory values, so a pad driven by T3 Code reads like the one in the
 * box.
 */
import { AGENT_KEY_COUNT, type AgentKeyState } from "./agentKeys";

export const AGENT_KEY_COLORS = {
  idle: 0xffffff,
  working: 0x304ffe,
  unread: 0x00ff4c,
  attention: 0xff6d00,
  error: 0xff0033,
} as const satisfies Record<AgentKeyState, number>;

const EFFECT_OFF = 0;
const EFFECT_SOLID = 1;
const EFFECT_SNAKE = 2;
const EFFECT_BREATH = 4;
const ANIMATION_SPEED = 0.4;

/** How long the glow confirms that a different thread opened. */
export const SELECTION_FLASH_MS = 4_000;

export interface AgentKeyLight {
  readonly state: AgentKeyState;
  /** The thread open in T3 Code; its key breathes instead of holding steady. */
  readonly selected: boolean;
}

interface LightSide {
  readonly e: number;
  readonly b: number;
  readonly s: number;
  readonly m: number;
  readonly c: number;
}

export interface PadLighting {
  readonly agentKeys: ReadonlyArray<{
    readonly id: number;
    readonly c: number;
    readonly b: number;
    readonly e: number;
    readonly s: number;
    readonly sk: number;
    readonly sa: number;
  }>;
  readonly glow: { readonly ambient: LightSide; readonly keys: LightSide };
}

const DARK_SIDE: LightSide = { e: EFFECT_OFF, b: 0, s: 0, m: 0, c: 0 };

export function buildPadLighting(input: {
  readonly keys: ReadonlyArray<AgentKeyLight | null>;
  /** 0-1, applied to every zone. */
  readonly brightness: number;
  /** The open thread, whether or not it holds a key. */
  readonly openThreadState: AgentKeyState | null;
  /** Within SELECTION_FLASH_MS of a different thread opening. */
  readonly flashing: boolean;
}): PadLighting {
  const agentKeys = Array.from({ length: AGENT_KEY_COUNT }, (_, id) => {
    const key = input.keys[id] ?? null;
    if (key === null) return { id, c: 0, b: 0, e: EFFECT_OFF, s: 0, sk: 0, sa: 0 };
    return {
      id,
      c: AGENT_KEY_COLORS[key.state],
      b: input.brightness,
      e: key.selected ? EFFECT_BREATH : EFFECT_SOLID,
      s: key.selected ? ANIMATION_SPEED : 0,
      sk: 0,
      sa: 0,
    };
  });
  const state = input.openThreadState;
  if (state !== null && input.flashing) {
    const side = { e: EFFECT_SOLID, b: input.brightness, s: 0, m: 0, c: AGENT_KEY_COLORS[state] };
    return { agentKeys, glow: { ambient: side, keys: side } };
  }
  if (state === "working") {
    const ambient = {
      e: EFFECT_SNAKE,
      b: input.brightness,
      s: ANIMATION_SPEED,
      m: 0,
      c: AGENT_KEY_COLORS.working,
    };
    return { agentKeys, glow: { ambient, keys: DARK_SIDE } };
  }
  return { agentKeys, glow: { ambient: DARK_SIDE, keys: DARK_SIDE } };
}

/** Everything off: auto-dim, and handing the pad back when T3 Code lets go. */
export const DARK_PAD_LIGHTING: PadLighting = buildPadLighting({
  keys: [],
  brightness: 0,
  openThreadState: null,
  flashing: false,
});
