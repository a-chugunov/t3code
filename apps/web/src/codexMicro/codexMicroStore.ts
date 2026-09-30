import { create } from "zustand";

import type { CodexMicroStatus } from "./protocol";
import type { CodexMicroTransport } from "./webHid";

interface PadIdentity {
  readonly productName: string;
  readonly transport: CodexMicroTransport;
}

export type CodexMicroPadState =
  | { readonly status: "off" }
  /** No WebHID: Safari, Firefox, or a page that is not a secure context. */
  | { readonly status: "unsupported" }
  /** Another T3 Code window or tab is driving the pad. */
  | { readonly status: "elsewhere" }
  /** Nothing granted or plugged in. */
  | { readonly status: "searching" }
  /** The OS refused to open the pad; on macOS that means Input Monitoring. */
  | { readonly status: "blocked"; readonly message: string }
  | ({ readonly status: "connecting" } & PadIdentity)
  | ({ readonly status: "connected"; readonly padStatus: CodexMicroStatus } & PadIdentity)
  /**
   * Open, but the pad never answered, so writes may be going nowhere.
   * `writesRefused` means the OS said no, as macOS does while the screen is locked.
   */
  | ({ readonly status: "unresponsive"; readonly writesRefused: boolean } & PadIdentity);

interface CodexMicroStore {
  readonly pad: CodexMicroPadState;
  /** Thread keys on AG00-AG05. */
  readonly agentKeys: ReadonlyArray<string | null>;
  /** Pad controls held down right now, for the live diagram in Settings. */
  readonly pressedKeys: ReadonlySet<string>;
  /** Bumped when the browser grants a pad, so the driver looks again. */
  readonly grantGeneration: number;
}

export const useCodexMicroStore = create<CodexMicroStore>()(() => ({
  pad: { status: "off" },
  agentKeys: [],
  pressedKeys: new Set(),
  grantGeneration: 0,
}));

export function setCodexMicroPad(pad: CodexMicroPadState): void {
  useCodexMicroStore.setState({ pad });
}

export function setCodexMicroKeyPressed(key: string, pressed: boolean): void {
  useCodexMicroStore.setState((state) => {
    if (state.pressedKeys.has(key) === pressed) return state;
    const pressedKeys = new Set(state.pressedKeys);
    if (pressed) pressedKeys.add(key);
    else pressedKeys.delete(key);
    return { pressedKeys };
  });
}
