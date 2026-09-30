import { describe, expect, it } from "vite-plus/test";

import { joystickDirection, PadGestureReader } from "./gestures";

const down = (key: string) => ({ type: "key" as const, key, phase: "down" as const });
const up = (key: string) => ({ type: "key" as const, key, phase: "up" as const });
const stick = (angle: number, distance: number) => ({
  type: "joystick" as const,
  angle,
  distance,
});

describe("PadGestureReader", () => {
  it("opens on the first Agent Key tap and raises on a quick second tap of the same key", () => {
    const reader = new PadGestureReader();
    expect(reader.read(down("AG02"), 0)).toEqual({ kind: "agent-key", index: 2, doubleTap: false });
    expect(reader.read(up("AG02"), 80)).toBeNull();
    expect(reader.read(down("AG02"), 200)).toEqual({
      kind: "agent-key",
      index: 2,
      doubleTap: true,
    });
    // A third tap starts over rather than chaining double taps.
    expect(reader.read(down("AG02"), 300)).toEqual({
      kind: "agent-key",
      index: 2,
      doubleTap: false,
    });
  });

  it("never counts taps on two different keys, or slow taps, as a double tap", () => {
    const reader = new PadGestureReader();
    reader.read(down("AG00"), 0);
    expect(reader.read(down("AG01"), 100)).toMatchObject({ doubleTap: false });
    expect(reader.read(down("AG01"), 600)).toMatchObject({ doubleTap: false });
  });

  it("reports the wide key once, though both of its switches fire", () => {
    const reader = new PadGestureReader();
    expect(reader.read(down("ACT10"), 0)).toEqual({ kind: "action-key", key: "ACT10" });
    expect(reader.read(down("ACT11"), 0)).toBeNull();
  });

  it("tells a dial press from a hold on release", () => {
    const reader = new PadGestureReader();
    expect(reader.read(down("ENC_CLK"), 0)).toBeNull();
    expect(reader.read(up("ENC_CLK"), 200)).toEqual({ kind: "dial-press" });
    reader.read(down("ENC_CLK"), 1_000);
    expect(reader.read(up("ENC_CLK"), 1_600)).toEqual({ kind: "dial-hold" });
  });

  it("turns each detent into one step", () => {
    const reader = new PadGestureReader();
    expect(reader.read({ type: "key", key: "ENC_CW", phase: "tick" }, 0)).toEqual({
      kind: "dial-turn",
      step: 1,
    });
    expect(reader.read({ type: "key", key: "ENC_CC", phase: "tick" }, 10)).toEqual({
      kind: "dial-turn",
      step: -1,
    });
  });

  it("fires the stick once per push and re-arms at centre", () => {
    const reader = new PadGestureReader();
    expect(reader.read(stick(0.75, 0.3), 0)).toBeNull();
    expect(reader.read(stick(0.75, 0.8), 10)).toEqual({ kind: "joystick", direction: "up" });
    expect(reader.read(stick(0.75, 1), 20)).toBeNull();
    expect(reader.read(stick(0, 0.4), 30)).toBeNull();
    expect(reader.read(stick(0, 0), 40)).toBeNull();
    expect(reader.read(stick(0.5, 0.9), 50)).toEqual({ kind: "joystick", direction: "left" });
  });
});

describe("joystickDirection", () => {
  it("splits the turn into quarters with right catching the wrap", () => {
    expect(joystickDirection(0.75)).toBe("up");
    expect(joystickDirection(0.25)).toBe("down");
    expect(joystickDirection(0.5)).toBe("left");
    expect(joystickDirection(0)).toBe("right");
    expect(joystickDirection(0.95)).toBe("right");
  });
});
