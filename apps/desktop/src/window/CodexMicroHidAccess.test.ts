import type * as Electron from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

import { allowCodexMicroHid } from "./CodexMicroHidAccess.ts";

const APP_ORIGIN = "t3code://app";
const pad = { deviceId: "pad", vendorId: 0x303a, productId: 0x8360, name: "Codex Micro" };
const keyboard = { deviceId: "keyboard", vendorId: 0x05ac, productId: 0x0342, name: "Keyboard" };

function fakeSession() {
  let permission: ((details: unknown) => boolean) | null = null;
  let select:
    | ((event: unknown, details: unknown, callback: (id: string | null) => void) => void)
    | null = null;
  const session = {
    setDevicePermissionHandler: vi.fn((handler: (details: unknown) => boolean) => {
      permission = handler;
    }),
    on: vi.fn((_name: string, handler: typeof select) => {
      select = handler;
    }),
  };
  allowCodexMicroHid(session as unknown as Electron.Session, APP_ORIGIN);
  return {
    session,
    allows: (device: object, origin = APP_ORIGIN) =>
      permission?.({ deviceType: "hid", origin, device }) ?? false,
    choose: (deviceList: object[], origin = APP_ORIGIN) => {
      let chosen: string | null | undefined;
      select?.({ preventDefault: () => {} }, { deviceList, frame: { origin } }, (id) => {
        chosen = id;
      });
      return chosen;
    },
  };
}

describe("allowCodexMicroHid", () => {
  it("grants the app its Codex Micro and nothing else", () => {
    const { allows } = fakeSession();
    expect(allows(pad)).toBe(true);
    expect(allows(keyboard)).toBe(false);
    expect(allows(pad, "https://example.com")).toBe(false);
  });

  it("answers the browser chooser with the pad, and only for the app", () => {
    const { choose } = fakeSession();
    expect(choose([keyboard, pad])).toBe("pad");
    expect(choose([keyboard])).toBeNull();
    expect(choose([pad], "https://example.com")).toBeNull();
  });

  it("configures a session once", () => {
    const { session } = fakeSession();
    allowCodexMicroHid(session as unknown as Electron.Session, APP_ORIGIN);
    expect(session.setDevicePermissionHandler).toHaveBeenCalledTimes(1);
  });
});
