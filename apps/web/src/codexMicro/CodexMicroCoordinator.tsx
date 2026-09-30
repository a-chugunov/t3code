import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { CodexMicroKeyAction } from "@t3tools/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useSidebar } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadShells } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import {
  agentKeyThreadKey,
  assignAgentKeys,
  rankAgentKeyThreads,
  resolveAgentKeyState,
  type AgentKeyState,
} from "./agentKeys";
import { setCodexMicroKeyPressed, setCodexMicroPad, useCodexMicroStore } from "./codexMicroStore";
import { CodexMicroConnection } from "./connection";
import { PadGestureReader, type PadGesture } from "./gestures";
import { buildPadLighting, DARK_PAD_LIGHTING, SELECTION_FLASH_MS } from "./lighting";
import { dispatchPadAction, type PadAction } from "./padActionBus";
import type { PadInputEvent } from "./protocol";
import {
  codexMicroTransport,
  getWebHid,
  isCodexMicro,
  type Hid,
  type HidConnectionEvent,
} from "./webHid";

const PAD_LOCK_NAME = "t3code:codex-micro";
const AGENT_KEYS_STORAGE_KEY = "t3code:codex-micro:agent-keys";
const StoredAgentKeys = Schema.Array(Schema.NullOr(Schema.String));
const STATUS_POLL_MS = 60_000;
// While the pad isn't answering (a locked Mac, usually), look again soon so it
// relights within seconds of coming back.
const RECOVERY_POLL_MS = 5_000;
const STATUS_RETRY_DELAYS_MS = [500, 2_000];
const JOYSTICK_ACTIVITY_DISTANCE = 0.1;
const CODEX_MICRO_SETTINGS_PATH = "/settings/codex-micro";

const UNAVAILABLE_MESSAGES: Record<PadAction, string> = {
  approve: "No approval is waiting in the open thread.",
  decline: "No approval is waiting in the open thread.",
  send: "Open a thread to send its draft.",
  stop: "Nothing is running in the open thread.",
  "fast-mode": "The open thread's model has no fast mode.",
  "new-thread": "Return to your threads to start a new one.",
};

const ATTENTION_ORDER: ReadonlyArray<AgentKeyState> = ["attention", "error", "unread"];

/**
 * Drives a Codex Micro from this client: the pad sits with the person, not the
 * environment, so it shows threads from every connected environment. Mounted
 * inside the sidebar provider because the thumbstick toggles the sidebar.
 */
export function CodexMicroCoordinator() {
  const enabled = useClientSettings((settings) => settings.codexMicroEnabled);
  const hid = getWebHid();
  useEffect(() => {
    if (!enabled) setCodexMicroPad({ status: "off" });
    else if (hid === null) setCodexMicroPad({ status: "unsupported" });
  }, [enabled, hid]);
  return enabled && hid !== null ? <CodexMicroDriver hid={hid} /> : null;
}

/** Only one window may drive the pad, or every press would act twice. */
function usePadLock(): boolean {
  const [owned, setOwned] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = () => {
      setOwned(true);
      return released;
    };
    void navigator.locks
      .request(PAD_LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (lock !== null) return hold();
        setCodexMicroPad({ status: "elsewhere" });
        void navigator.locks.request(PAD_LOCK_NAME, { signal: abort.signal }, hold).catch(() => {});
        return undefined;
      })
      .catch(() => {});
    return () => {
      abort.abort();
      release();
      setOwned(false);
    };
  }, []);
  return owned;
}

// WebHID hands out one HIDDevice per pad, so opening and releasing it run one
// at a time. Otherwise an attempt abandoned mid-open (a quick toggle, or React
// remounting) closes the device under the attempt that replaced it.
let padLifecycle: Promise<unknown> = Promise.resolve();
function queuePadLifecycle<T>(task: () => Promise<T>): Promise<T> {
  const run = padLifecycle.then(task);
  padLifecycle = run.catch(() => undefined);
  return run;
}

function usePadConnection(
  hid: Hid,
  enabled: boolean,
  onEvent: (event: PadInputEvent) => void,
): { readonly connection: CodexMicroConnection | null; readonly repaint: number } {
  const [connection, setConnection] = useState<CodexMicroConnection | null>(null);
  // Bumped when the pad answers again after a silence, to send its lights in full.
  const [repaint, setRepaint] = useState(0);
  const grantGeneration = useCodexMicroStore((state) => state.grantGeneration);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // A new grant from the browser chooser means look for the pad again.
    void grantGeneration;
    if (!enabled) return;
    let disposed = false;
    let opening = false;
    let current: CodexMicroConnection | null = null;
    let answering = true;
    let pollTimer: number | undefined;

    /** Resolves whether the pad answered. */
    const refreshStatus = async (retryDelaysMs: ReadonlyArray<number> = []) => {
      const opened = current;
      if (opened === null) return false;
      let padStatus = await opened.status();
      for (const delayMs of retryDelaysMs) {
        if (padStatus !== null || disposed || current !== opened) break;
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        padStatus = await opened.status();
      }
      if (disposed || current !== opened) return false;
      const { productName } = opened.device;
      const transport = codexMicroTransport(productName);
      if (padStatus === null) {
        answering = false;
        setCodexMicroPad({
          status: "unresponsive",
          productName,
          transport,
          writesRefused: opened.writesRefused,
        });
        return false;
      }
      if (!answering) {
        answering = true;
        opened.forgetLighting();
        setRepaint((count) => count + 1);
      }
      setCodexMicroPad({ status: "connected", productName, transport, padStatus });
      return true;
    };

    const schedulePoll = (answered: boolean) => {
      window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(
        async () => {
          const next = await refreshStatus();
          if (!disposed) schedulePoll(next);
        },
        answered ? STATUS_POLL_MS : RECOVERY_POLL_MS,
      );
    };

    const openPad = () =>
      queuePadLifecycle(async (): Promise<CodexMicroConnection | null> => {
        if (disposed) return null;
        const pads = (await hid.getDevices()).filter(isCodexMicro);
        // Cabled and paired at once: the cable is the steadier link.
        const device =
          pads.find((pad) => codexMicroTransport(pad.productName) === "usb") ?? pads[0];
        if (disposed) return null;
        if (device === undefined) {
          setCodexMicroPad({ status: "searching" });
          return null;
        }
        try {
          if (!device.opened) await device.open();
        } catch (error) {
          if (!disposed) {
            setCodexMicroPad({
              status: "blocked",
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return null;
        }
        if (disposed) {
          await device.close().catch(() => undefined);
          return null;
        }
        current = new CodexMicroConnection(device, (event) => onEventRef.current(event));
        setCodexMicroPad({
          status: "connecting",
          productName: device.productName,
          transport: codexMicroTransport(device.productName),
        });
        return current;
      });

    const connect = async () => {
      if (disposed || opening || current !== null) return;
      opening = true;
      try {
        const opened = await openPad();
        if (opened === null) return;
        // A reply proves writes land. The first request after opening is
        // sometimes lost, so ask again before painting or giving up.
        const answered = await refreshStatus(STATUS_RETRY_DELAYS_MS);
        if (disposed || current !== opened) return;
        setConnection(opened);
        schedulePoll(answered);
      } finally {
        opening = false;
      }
    };

    const onConnect = () => void connect();
    const onDisconnect = (event: Event) => {
      const closing = current;
      if (closing === null || (event as HidConnectionEvent).device !== closing.device) return;
      current = null;
      setConnection(null);
      setCodexMicroPad({ status: "searching" });
      void queuePadLifecycle(() => closing.close());
      void connect();
    };
    // Best effort: the page may be gone before the write lands.
    const onPageHide = () => void current?.applyLighting(DARK_PAD_LIGHTING).catch(() => undefined);
    hid.addEventListener("connect", onConnect);
    hid.addEventListener("disconnect", onDisconnect);
    window.addEventListener("pagehide", onPageHide);
    void connect();

    return () => {
      disposed = true;
      window.clearTimeout(pollTimer);
      hid.removeEventListener("connect", onConnect);
      hid.removeEventListener("disconnect", onDisconnect);
      window.removeEventListener("pagehide", onPageHide);
      const closing = current;
      current = null;
      setConnection(null);
      // Hand the pad back dark, as the ChatGPT app does when it lets go.
      if (closing !== null) {
        void queuePadLifecycle(async () => {
          await closing.applyLighting(DARK_PAD_LIGHTING).catch(() => undefined);
          await closing.close();
        });
      }
    };
  }, [enabled, grantGeneration, hid]);

  return { connection, repaint };
}

function readStoredAgentKeys(): ReadonlyArray<string | null> {
  try {
    return getLocalStorageItem(AGENT_KEYS_STORAGE_KEY, StoredAgentKeys) ?? [];
  } catch {
    return [];
  }
}

function sameAgentKeys(left: ReadonlyArray<string | null>, right: ReadonlyArray<string | null>) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function trackPressedControls(event: PadInputEvent): void {
  if (event.type === "key") {
    if (event.phase === "tick") {
      setCodexMicroKeyPressed(event.key, true);
      window.setTimeout(() => setCodexMicroKeyPressed(event.key, false), 150);
    } else {
      setCodexMicroKeyPressed(event.key, event.phase === "down");
    }
  } else {
    setCodexMicroKeyPressed("JOYSTICK", event.distance > JOYSTICK_ACTIVITY_DISTANCE);
  }
}

function runPadAction(action: CodexMicroKeyAction): void {
  if (action === "none") return;
  const outcome = dispatchPadAction(action);
  if (outcome === "done") return;
  if (outcome === "fast-mode-on" || outcome === "fast-mode-off") {
    toastManager.add({
      type: "info",
      title: outcome === "fast-mode-on" ? "Fast mode on" : "Fast mode off",
    });
    return;
  }
  toastManager.add({ type: "info", title: UNAVAILABLE_MESSAGES[action] });
}

function CodexMicroDriver({ hid }: { readonly hid: Hid }) {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const brightness = useClientSettings((settings) => settings.codexMicroBrightness);
  const autoDimSeconds = useClientSettings((settings) => settings.codexMicroAutoDimSeconds);
  const keyActions = useClientSettings((settings) => settings.codexMicroKeyActions);
  const threads = useThreadShells();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const nowMinute = useNowMinute();
  // On the pad's own settings page a press only lights its key on screen, so
  // people can find which key is which without setting anything off.
  const identifyingKeys = useLocation({
    select: (location) => location.pathname === CODEX_MICRO_SETTINGS_PATH,
  });
  const openThreadKey = useParams({
    strict: false,
    select: (params) => {
      const ref = resolveThreadRouteRef(params);
      return ref === null ? null : scopedThreadKey(ref);
    },
  });

  // Snoozes wake on the clock, so ranking re-runs each minute as well.
  const ranked = useMemo(
    () => rankAgentKeyThreads(threads, `${nowMinute}:00.000Z`),
    [threads, nowMinute],
  );
  const threadByKey = useMemo(
    () => new Map(threads.map((thread) => [agentKeyThreadKey(thread), thread] as const)),
    [threads],
  );

  const [agentKeys, setAgentKeys] = useState(readStoredAgentKeys);
  useEffect(() => {
    const rankedKeys = ranked.map(agentKeyThreadKey);
    const known = new Set(threadByKey.keys());
    setAgentKeys((previous) => {
      const next = assignAgentKeys(previous, rankedKeys, known);
      return sameAgentKeys(previous, next) ? previous : next;
    });
  }, [ranked, threadByKey]);
  useEffect(() => {
    setLocalStorageItem(AGENT_KEYS_STORAGE_KEY, agentKeys, StoredAgentKeys);
    useCodexMicroStore.setState({ agentKeys });
  }, [agentKeys]);

  const [flashing, setFlashing] = useState(false);
  const previousOpenThreadKey = useRef(openThreadKey);
  useEffect(() => {
    if (previousOpenThreadKey.current === openThreadKey) return;
    previousOpenThreadKey.current = openThreadKey;
    if (openThreadKey === null) return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), SELECTION_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [openThreadKey]);

  const stateOf = useCallback(
    (threadKey: string | null): AgentKeyState | null => {
      const thread = threadKey === null ? undefined : threadByKey.get(threadKey);
      if (thread === undefined || threadKey === null) return null;
      return resolveAgentKeyState(thread, lastVisitedById[threadKey]);
    },
    [lastVisitedById, threadByKey],
  );
  const lighting = useMemo(
    () =>
      buildPadLighting({
        keys: agentKeys.map((threadKey) => {
          const state = stateOf(threadKey);
          return state === null ? null : { state, selected: threadKey === openThreadKey };
        }),
        brightness: brightness / 100,
        openThreadState: stateOf(openThreadKey),
        flashing,
      }),
    [agentKeys, brightness, flashing, openThreadKey, stateOf],
  );
  const lightingKey = JSON.stringify(lighting);

  // Dim means dark, as on the factory pad. Pad input and any change on the
  // pad wake it.
  const [dimmed, setDimmed] = useState(false);
  const dimTimer = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setDimmed(false);
    window.clearTimeout(dimTimer.current);
    if (autoDimSeconds > 0) {
      dimTimer.current = window.setTimeout(() => setDimmed(true), autoDimSeconds * 1000);
    }
  }, [autoDimSeconds]);
  // Keyed on the serialized frame: a new object with the same lights is no change.
  useEffect(() => {
    void lightingKey;
    wake();
    return () => window.clearTimeout(dimTimer.current);
  }, [lightingKey, wake]);

  const gestures = useRef(new PadGestureReader());
  const latest = useRef({
    agentKeys,
    ranked,
    openThreadKey,
    identifyingKeys,
    keyActions,
    threadByKey,
    stateOf,
  });
  latest.current = {
    agentKeys,
    ranked,
    openThreadKey,
    identifyingKeys,
    keyActions,
    threadByKey,
    stateOf,
  };

  const openThread = useCallback(
    (thread: EnvironmentThreadShell) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: thread.environmentId, threadId: thread.id },
      }),
    [navigate],
  );

  const runGesture = useCallback(
    (gesture: PadGesture) => {
      const context = latest.current;
      switch (gesture.kind) {
        case "agent-key": {
          const threadKey = context.agentKeys[gesture.index] ?? null;
          const thread = threadKey === null ? undefined : context.threadByKey.get(threadKey);
          if (thread === undefined) return;
          openThread(thread);
          // A double tap also brings T3 Code forward, as it raises the ChatGPT app.
          if (gesture.doubleTap) {
            if (window.desktopBridge?.revealWindow) void window.desktopBridge.revealWindow();
            else window.focus();
          }
          return;
        }
        case "action-key":
          runPadAction(context.keyActions[gesture.key]);
          return;
        case "dial-turn": {
          const count = context.ranked.length;
          if (count === 0) return;
          const index = context.ranked.findIndex(
            (thread) => agentKeyThreadKey(thread) === context.openThreadKey,
          );
          const next =
            index === -1
              ? gesture.step > 0
                ? 0
                : count - 1
              : (index + gesture.step + count) % count;
          const thread = context.ranked[next];
          if (thread !== undefined) openThread(thread);
          return;
        }
        case "dial-press": {
          for (const wanted of ATTENTION_ORDER) {
            const thread = context.ranked.find(
              (candidate) => context.stateOf(agentKeyThreadKey(candidate)) === wanted,
            );
            if (thread !== undefined) {
              openThread(thread);
              return;
            }
          }
          toastManager.add({ type: "info", title: "Nothing needs you right now." });
          return;
        }
        case "dial-hold":
          void navigate({ to: CODEX_MICRO_SETTINGS_PATH });
          return;
        case "joystick":
          if (gesture.direction === "up") openCommandPalette();
          else if (gesture.direction === "down") toggleSidebar();
          else if (gesture.direction === "left") window.history.back();
          else window.history.forward();
          return;
      }
    },
    [navigate, openThread, toggleSidebar],
  );

  const handleEvent = useCallback(
    (event: PadInputEvent) => {
      trackPressedControls(event);
      if (event.type === "key" || event.distance > JOYSTICK_ACTIVITY_DISTANCE) wake();
      const gesture = gestures.current.read(event, performance.now());
      if (gesture !== null && !latest.current.identifyingKeys) runGesture(gesture);
    },
    [runGesture, wake],
  );

  const ownsPad = usePadLock();
  const { connection, repaint } = usePadConnection(hid, ownsPad, handleEvent);

  useEffect(() => {
    void repaint;
    if (connection === null) return;
    void connection.applyLighting(dimmed ? DARK_PAD_LIGHTING : lighting).catch(() => undefined);
  }, [connection, dimmed, lighting, repaint]);

  return null;
}
