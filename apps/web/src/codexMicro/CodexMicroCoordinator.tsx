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
  AGENT_KEY_COUNT,
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

const UNAVAILABLE_MESSAGES: Record<PadAction["type"], string> = {
  approve: "No approval is waiting in the open thread.",
  decline: "No approval is waiting in the open thread.",
  send: "Open a thread to send its draft.",
  stop: "Nothing is running in the open thread.",
  "fast-mode": "The open thread's model has no fast mode.",
  "new-thread": "Return to your threads to start a new one.",
  "insert-text": "Open a thread to type into its composer.",
  scroll: "Open a thread to scroll it.",
  "scroll-latest": "Open a thread to scroll it.",
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

/** Hands an action to the view that owns it, and says so when nothing could act. */
function runBusAction(action: PadAction): void {
  const outcome = dispatchPadAction(action);
  if (outcome === "done") return;
  if (outcome === "fast-mode-on" || outcome === "fast-mode-off") {
    toastManager.add({
      type: "info",
      title: outcome === "fast-mode-on" ? "Fast mode on" : "Fast mode off",
    });
    return;
  }
  // A dial turn with nothing to scroll is not worth a toast per detent.
  if (action.type === "scroll") return;
  toastManager.add({ type: "info", title: UNAVAILABLE_MESSAGES[action.type] });
}

function CodexMicroDriver({ hid }: { readonly hid: Hid }) {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const brightness = useClientSettings((settings) => settings.codexMicroBrightness);
  const autoDimSeconds = useClientSettings((settings) => settings.codexMicroAutoDimSeconds);
  const keyActions = useClientSettings((settings) => settings.codexMicroKeyActions);
  const keyTexts = useClientSettings((settings) => settings.codexMicroKeyTexts);
  const splitWideKey = useClientSettings((settings) => settings.codexMicroSplitWideKey);
  const dialMode = useClientSettings((settings) => settings.codexMicroDialMode);
  const stickActions = useClientSettings((settings) => settings.codexMicroStickActions);
  const agentKeyMode = useClientSettings((settings) => settings.codexMicroAgentKeyMode);
  const customAgentKeys = useClientSettings((settings) => settings.codexMicroAgentKeyThreads);
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

  // Snoozes wake on the clock, so ranking re-runs each minute as well. The
  // dial and the thread-stepping actions always walk the whole inbox.
  const ranked = useMemo(
    () => rankAgentKeyThreads(threads, `${nowMinute}:00.000Z`),
    [threads, nowMinute],
  );
  const keyCandidates = useMemo(
    () =>
      agentKeyMode === "pinned"
        ? rankAgentKeyThreads(threads, `${nowMinute}:00.000Z`, "pinned")
        : ranked,
    [agentKeyMode, nowMinute, ranked, threads],
  );
  const threadByKey = useMemo(
    () => new Map(threads.map((thread) => [agentKeyThreadKey(thread), thread] as const)),
    [threads],
  );

  const [followedAgentKeys, setFollowedAgentKeys] = useState(readStoredAgentKeys);
  useEffect(() => {
    if (agentKeyMode === "custom") return;
    const candidateKeys = keyCandidates.map(agentKeyThreadKey);
    const known = new Set(threadByKey.keys());
    setFollowedAgentKeys((previous) => {
      const next = assignAgentKeys(previous, candidateKeys, known);
      return sameAgentKeys(previous, next) ? previous : next;
    });
  }, [agentKeyMode, keyCandidates, threadByKey]);
  useEffect(() => {
    setLocalStorageItem(AGENT_KEYS_STORAGE_KEY, followedAgentKeys, StoredAgentKeys);
  }, [followedAgentKeys]);
  // Chosen keys stay put: a thread you placed keeps its key even when settled.
  const agentKeys = useMemo(
    () =>
      agentKeyMode === "custom"
        ? Array.from({ length: AGENT_KEY_COUNT }, (_, index) => customAgentKeys[index] ?? null)
        : followedAgentKeys,
    [agentKeyMode, customAgentKeys, followedAgentKeys],
  );
  useEffect(() => {
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
    keyTexts,
    splitWideKey,
    dialMode,
    stickActions,
    threadByKey,
    stateOf,
  });
  latest.current = {
    agentKeys,
    ranked,
    openThreadKey,
    identifyingKeys,
    keyActions,
    keyTexts,
    splitWideKey,
    dialMode,
    stickActions,
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

  const stepThread = useCallback(
    (step: 1 | -1) => {
      const { ranked: inbox, openThreadKey: open } = latest.current;
      if (inbox.length === 0) return;
      const index = inbox.findIndex((thread) => agentKeyThreadKey(thread) === open);
      const next =
        index === -1
          ? step > 0
            ? 0
            : inbox.length - 1
          : (index + step + inbox.length) % inbox.length;
      const thread = inbox[next];
      if (thread !== undefined) openThread(thread);
    },
    [openThread],
  );

  const openAttention = useCallback(() => {
    const { ranked: inbox, stateOf: stateOfKey } = latest.current;
    for (const wanted of ATTENTION_ORDER) {
      const thread = inbox.find((candidate) => stateOfKey(agentKeyThreadKey(candidate)) === wanted);
      if (thread !== undefined) {
        openThread(thread);
        return;
      }
    }
    toastManager.add({ type: "info", title: "Nothing needs you right now." });
  }, [openThread]);

  const runKeyAction = useCallback(
    (action: CodexMicroKeyAction, text: string | undefined) => {
      switch (action) {
        case "none":
          return;
        case "command-palette":
          openCommandPalette();
          return;
        case "toggle-sidebar":
          toggleSidebar();
          return;
        case "back":
          window.history.back();
          return;
        case "forward":
          window.history.forward();
          return;
        case "previous-thread":
          stepThread(-1);
          return;
        case "next-thread":
          stepThread(1);
          return;
        case "open-attention":
          openAttention();
          return;
        case "insert-text":
          if (!text) {
            toastManager.add({
              type: "info",
              title: "This key has no text yet. Set it in Settings.",
            });
            return;
          }
          runBusAction({ type: "insert-text", text });
          return;
        default:
          runBusAction({ type: action });
      }
    },
    [openAttention, stepThread, toggleSidebar],
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
          // One wide keycap presses both switches; only a split slot has two keys.
          if (gesture.key === "ACT11" && !context.splitWideKey) return;
          runKeyAction(context.keyActions[gesture.key], context.keyTexts[gesture.key]);
          return;
        case "dial-turn":
          if (context.dialMode === "scroll") runBusAction({ type: "scroll", step: gesture.step });
          else stepThread(gesture.step);
          return;
        case "dial-press":
          if (context.dialMode === "scroll") runBusAction({ type: "scroll-latest" });
          else openAttention();
          return;
        case "dial-hold":
          void navigate({ to: CODEX_MICRO_SETTINGS_PATH });
          return;
        case "joystick":
          runKeyAction(context.stickActions[gesture.direction], undefined);
          return;
      }
    },
    [navigate, openAttention, openThread, runKeyAction, stepThread],
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
