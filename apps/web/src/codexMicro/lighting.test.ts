import { describe, expect, it } from "vite-plus/test";

import { AGENT_KEY_COLORS, buildPadLighting, DARK_PAD_LIGHTING } from "./lighting";

describe("buildPadLighting", () => {
  it("lights keys that hold a thread, breathes the open one, and leaves the rest dark", () => {
    const { agentKeys } = buildPadLighting({
      keys: [{ state: "attention", selected: false }, null, { state: "working", selected: true }],
      brightness: 0.5,
      openThreadState: "working",
      flashing: false,
    });

    expect(agentKeys).toHaveLength(6);
    expect(agentKeys[0]).toEqual({
      id: 0,
      c: AGENT_KEY_COLORS.attention,
      b: 0.5,
      e: 1,
      s: 0,
      sk: 0,
      sa: 0,
    });
    expect(agentKeys[1]).toEqual({ id: 1, c: 0, b: 0, e: 0, s: 0, sk: 0, sa: 0 });
    expect(agentKeys[2]).toMatchObject({ c: AGENT_KEY_COLORS.working, e: 4, s: 0.4 });
    expect(agentKeys[5]).toMatchObject({ e: 0, b: 0 });
  });

  it("runs the glow while the open thread works and keeps the key backlight dark", () => {
    const { glow } = buildPadLighting({
      keys: [],
      brightness: 1,
      openThreadState: "working",
      flashing: false,
    });
    expect(glow.ambient).toMatchObject({ e: 2, c: AGENT_KEY_COLORS.working, s: 0.4 });
    expect(glow.keys).toMatchObject({ e: 0, b: 0 });
  });

  it("flashes both glows in the open thread's colour after switching threads", () => {
    const { glow } = buildPadLighting({
      keys: [],
      brightness: 1,
      openThreadState: "unread",
      flashing: true,
    });
    expect(glow.ambient).toMatchObject({ e: 1, c: AGENT_KEY_COLORS.unread });
    expect(glow.keys).toEqual(glow.ambient);
  });

  it("keeps the glow off for a settled open thread", () => {
    const { glow } = buildPadLighting({
      keys: [],
      brightness: 1,
      openThreadState: "idle",
      flashing: false,
    });
    expect(glow).toEqual(DARK_PAD_LIGHTING.glow);
  });
});
