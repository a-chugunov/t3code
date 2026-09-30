import {
  CODEX_MICRO_KEY_ACTIONS,
  CODEX_MICRO_STICK_DIRECTIONS,
  CodexMicroAgentKeyMode,
  CodexMicroAutoDimSeconds,
  CodexMicroDialMode,
  DEFAULT_CLIENT_SETTINGS,
  type CodexMicroActionKey,
  type CodexMicroKeyAction,
  type CodexMicroKeyActions,
  type CodexMicroKeyTexts,
  type CodexMicroStickActions,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useMemo, useState, type CSSProperties } from "react";

import {
  agentKeyThreadKey,
  placeAgentKeyThread,
  rankAgentKeyThreads,
  resolveAgentKeyState,
  type AgentKeyState,
} from "../../codexMicro/agentKeys";
import { useCodexMicroStore } from "../../codexMicro/codexMicroStore";
import { AGENT_KEY_COLORS } from "../../codexMicro/lighting";
import { CODEX_MICRO_HID_FILTER, getWebHid } from "../../codexMicro/webHid";
import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { cn, isMacPlatform } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AGENT_KEY_STATE_LABELS,
  CODEX_MICRO_ACTION_GROUPS,
  CODEX_MICRO_AGENT_KEY_MODE_LABELS,
  CODEX_MICRO_AUTO_DIM_LABELS,
  CODEX_MICRO_DIAL_MODE_LABELS,
  CODEX_MICRO_KEY_ACTION_LABELS,
  CODEX_MICRO_STICK_DIRECTION_LABELS,
  codexMicroKeyLabel,
  codexMicroStatusLabel,
} from "./CodexMicroSettings.logic";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const AUTO_DIM_OPTIONS = CodexMicroAutoDimSeconds.literals;
const isAutoDimSeconds = Schema.is(CodexMicroAutoDimSeconds);
const isAgentKeyMode = Schema.is(CodexMicroAgentKeyMode);
const isDialMode = Schema.is(CodexMicroDialMode);
const AGENT_KEY_STATES: ReadonlyArray<AgentKeyState> = [
  "idle",
  "working",
  "attention",
  "unread",
  "error",
];
const NO_THREAD = "none";

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function asKeyAction(value: unknown): CodexMicroKeyAction | undefined {
  return CODEX_MICRO_KEY_ACTIONS.find((candidate) => candidate === value);
}

async function connectInBrowser() {
  const hid = getWebHid();
  if (hid === null) return;
  try {
    const granted = await hid.requestDevice({ filters: [CODEX_MICRO_HID_FILTER] });
    if (granted.length === 0) return;
    useCodexMicroStore.setState((state) => ({ grantGeneration: state.grantGeneration + 1 }));
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Couldn't connect Codex Micro",
      description: error instanceof Error ? error.message : "Try again.",
    });
  }
}

async function openInputMonitoringSettings() {
  await readLocalApi()
    ?.shell.openSystemSettings("input-monitoring")
    .catch(() => {
      toastManager.add({
        type: "error",
        title: "Could not open System Settings",
        description: "Open Privacy & Security → Input Monitoring manually.",
      });
    });
}

export function CodexMicroSettings() {
  const enabled = useClientSettings((settings) => settings.codexMicroEnabled);
  const brightness = useClientSettings((settings) => settings.codexMicroBrightness);
  const autoDimSeconds = useClientSettings((settings) => settings.codexMicroAutoDimSeconds);
  const keyActions = useClientSettings((settings) => settings.codexMicroKeyActions);
  const keyTexts = useClientSettings((settings) => settings.codexMicroKeyTexts);
  const splitWideKey = useClientSettings((settings) => settings.codexMicroSplitWideKey);
  const dialMode = useClientSettings((settings) => settings.codexMicroDialMode);
  const stickActions = useClientSettings((settings) => settings.codexMicroStickActions);
  const agentKeyMode = useClientSettings((settings) => settings.codexMicroAgentKeyMode);
  const customAgentKeys = useClientSettings((settings) => settings.codexMicroAgentKeyThreads);
  const updateSettings = useUpdateClientSettings();
  const pad = useCodexMicroStore((state) => state.pad);
  const agentKeysOnPad = useCodexMicroStore((state) => state.agentKeys);
  const [textEditor, setTextEditor] = useState<{
    readonly key: CodexMicroActionKey;
    readonly text: string;
  } | null>(null);
  const mac = isMacPlatform(navigator.platform);
  const brightnessSliderStyle = {
    "--settings-slider-progress": `${((brightness - 10) / 90) * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - (brightness - 10) / 90}rem`,
  } as CSSProperties;

  const changeKeyAction = (key: CodexMicroActionKey, action: CodexMicroKeyAction) => {
    if (action === "insert-text") {
      setTextEditor({ key, text: keyTexts[key] ?? "" });
      return;
    }
    updateSettings({ codexMicroKeyActions: { ...keyActions, [key]: action } });
  };
  const assignAgentKey = (index: number, threadKey: string | null) =>
    updateSettings({
      codexMicroAgentKeyThreads: placeAgentKeyThread(customAgentKeys, index, threadKey),
    });
  const changeAgentKeyMode = (mode: CodexMicroAgentKeyMode) => {
    // Choosing keys starts from what the pad shows now, not from a dark pad.
    const firstChoice =
      mode === "custom" && customAgentKeys.every((threadKey) => threadKey === null);
    updateSettings(
      firstChoice
        ? { codexMicroAgentKeyMode: mode, codexMicroAgentKeyThreads: [...agentKeysOnPad] }
        : { codexMicroAgentKeyMode: mode },
    );
  };

  return (
    <SettingsPageContainer>
      <SettingsSection id="codex-micro" title="Codex Micro">
        <SettingsRow
          {...searchableSetting("codex-micro-enabled")}
          description="Show your threads on the Agent Keys and act on them from the pad. Quit the ChatGPT app while you do: it drives the same lights and keys whenever it runs."
          status={codexMicroStatusLabel(pad, { desktop: isElectron, mac })}
          control={
            <>
              {enabled && pad.status === "searching" && !isElectron ? (
                <Button size="xs" variant="outline" onClick={() => void connectInBrowser()}>
                  Connect
                </Button>
              ) : null}
              {enabled && pad.status === "blocked" && isElectron && mac ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void openInputMonitoringSettings()}
                >
                  Open Input Monitoring
                </Button>
              ) : null}
              <Switch
                checked={enabled}
                aria-label="Use Codex Micro"
                onCheckedChange={(checked) => updateSettings({ codexMicroEnabled: checked })}
              />
            </>
          }
        />
        {enabled ? (
          <SettingsRow
            {...searchableSetting("codex-micro-keys")}
            description={
              agentKeyMode === "custom"
                ? "Select an Agent Key to choose its thread, and an action key to choose what it does. While this page is open, pressing a key on the pad only lights it up here."
                : "Select an action key to choose what it does. While this page is open, pressing a key on the pad only lights it up here, so you can find it first."
            }
          >
            <div className="flex flex-col gap-4 pt-2 pb-3 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-start">
              <PadDiagram
                keyActions={keyActions}
                keyTexts={keyTexts}
                splitWideKey={splitWideKey}
                assignable={agentKeyMode === "custom"}
                onKeyActionChange={changeKeyAction}
                onAssignAgentKey={assignAgentKey}
              />
              <PadHelp dialMode={dialMode} stickActions={stickActions} />
            </div>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      {enabled ? (
        <SettingsSection id="codex-micro-controls" title="Controls">
          <SettingsRow
            {...searchableSetting("codex-micro-agent-key-mode")}
            description="Pinned and active threads keep their keys while they stay in your first six. Pinned threads follow your Pinned list. Threads you choose stay on their keys until you change them."
            control={
              <Select
                value={agentKeyMode}
                onValueChange={(value) => {
                  if (isAgentKeyMode(value)) changeAgentKeyMode(value);
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Agent Keys hold">
                  <SelectValue>{CODEX_MICRO_AGENT_KEY_MODE_LABELS[agentKeyMode]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {CodexMicroAgentKeyMode.literals.map((mode) => (
                    <SelectItem hideIndicator key={mode} value={mode}>
                      {CODEX_MICRO_AGENT_KEY_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("codex-micro-dial")}
            description={
              dialMode === "scroll"
                ? "Turn to scroll the open conversation, press to jump to the latest message."
                : "Turn to move between threads, press to open the thread that needs you."
            }
            control={
              <Select
                value={dialMode}
                onValueChange={(value) => {
                  if (isDialMode(value)) updateSettings({ codexMicroDialMode: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Dial">
                  <SelectValue>{CODEX_MICRO_DIAL_MODE_LABELS[dialMode]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {CodexMicroDialMode.literals.map((mode) => (
                    <SelectItem hideIndicator key={mode} value={mode}>
                      {CODEX_MICRO_DIAL_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("codex-micro-stick")}
            description="Push the stick past halfway to trigger a direction, then let it return to the middle."
          >
            <div className="grid gap-2 pt-1 pb-3 @min-[32rem]/settings-row:grid-cols-2">
              {CODEX_MICRO_STICK_DIRECTIONS.map((direction) => (
                <label key={direction} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {CODEX_MICRO_STICK_DIRECTION_LABELS[direction]}
                  </span>
                  <Select
                    value={stickActions[direction]}
                    onValueChange={(value) => {
                      const action = asKeyAction(value);
                      if (action !== undefined) {
                        updateSettings({
                          codexMicroStickActions: { ...stickActions, [direction]: action },
                        });
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-44"
                      aria-label={`Stick ${CODEX_MICRO_STICK_DIRECTION_LABELS[direction]}`}
                    >
                      <SelectValue>
                        {CODEX_MICRO_KEY_ACTION_LABELS[stickActions[direction]]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {CODEX_MICRO_KEY_ACTIONS.filter((action) => action !== "insert-text").map(
                        (action) => (
                          <SelectItem hideIndicator key={action} value={action}>
                            {CODEX_MICRO_KEY_ACTION_LABELS[action]}
                          </SelectItem>
                        ),
                      )}
                    </SelectPopup>
                  </Select>
                </label>
              ))}
            </div>
          </SettingsRow>
          <SettingsRow
            {...searchableSetting("codex-micro-wide-key")}
            description="For two single keycaps in the wide MIC slot. Each of its switches then gets its own action."
            control={
              <Switch
                checked={splitWideKey}
                aria-label="Split the wide key"
                onCheckedChange={(checked) => updateSettings({ codexMicroSplitWideKey: checked })}
              />
            }
          />
        </SettingsSection>
      ) : null}

      {enabled ? (
        <SettingsSection id="codex-micro-lighting" title="Lighting">
          <SettingsRow
            {...searchableSetting("codex-micro-brightness")}
            description="Applies to the Agent Keys and the glow around the pad."
            resetAction={
              brightness !== DEFAULT_CLIENT_SETTINGS.codexMicroBrightness ? (
                <SettingResetButton
                  label="brightness"
                  onClick={() =>
                    updateSettings({
                      codexMicroBrightness: DEFAULT_CLIENT_SETTINGS.codexMicroBrightness,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center gap-3 sm:w-52">
                <output
                  className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  htmlFor="codex-micro-brightness-slider"
                >
                  {brightness}%
                </output>
                <input
                  aria-label="Brightness"
                  className="settings-slider min-w-0 flex-1"
                  id="codex-micro-brightness-slider"
                  max={100}
                  min={10}
                  step={10}
                  style={brightnessSliderStyle}
                  type="range"
                  value={brightness}
                  onChange={(event) =>
                    updateSettings({ codexMicroBrightness: Number(event.currentTarget.value) })
                  }
                />
              </div>
            }
          />
          <SettingsRow
            {...searchableSetting("codex-micro-auto-dim")}
            description="Turns the lights off when nothing changes. Any key press or thread update turns them back on."
            control={
              <Select
                value={String(autoDimSeconds)}
                onValueChange={(value) => {
                  const seconds = Number(value);
                  if (isAutoDimSeconds(seconds))
                    updateSettings({ codexMicroAutoDimSeconds: seconds });
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Auto-dim">
                  <SelectValue>{CODEX_MICRO_AUTO_DIM_LABELS[autoDimSeconds]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {AUTO_DIM_OPTIONS.map((seconds) => (
                    <SelectItem hideIndicator key={seconds} value={String(seconds)}>
                      {CODEX_MICRO_AUTO_DIM_LABELS[seconds]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </SettingsSection>
      ) : null}

      {textEditor !== null ? (
        <KeyTextDialog
          key={textEditor.key}
          initialText={textEditor.text}
          onClose={() => setTextEditor(null)}
          onSave={(text) => {
            updateSettings({
              codexMicroKeyActions: { ...keyActions, [textEditor.key]: "insert-text" },
              codexMicroKeyTexts: { ...keyTexts, [textEditor.key]: text },
            });
            setTextEditor(null);
          }}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

function PadHelp({
  dialMode,
  stickActions,
}: {
  readonly dialMode: CodexMicroDialMode;
  readonly stickActions: CodexMicroStickActions;
}) {
  const stick = CODEX_MICRO_STICK_DIRECTIONS.map(
    (direction) =>
      `${CODEX_MICRO_STICK_DIRECTION_LABELS[direction].toLowerCase()} ${CODEX_MICRO_KEY_ACTION_LABELS[stickActions[direction]].toLowerCase()}`,
  ).join(", ");
  return (
    <div className="flex min-w-0 flex-col gap-3 text-xs text-muted-foreground">
      <ul className="flex flex-col gap-1.5" aria-label="Agent Key colors">
        {AGENT_KEY_STATES.map((state) => (
          <li key={state} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full border border-foreground/15"
              style={{ backgroundColor: cssColor(AGENT_KEY_COLORS[state]) }}
            />
            {AGENT_KEY_STATE_LABELS[state]}
          </li>
        ))}
      </ul>
      <p>
        <span className="font-medium text-foreground">Tap</span> an Agent Key to open its thread.
        Tap twice to bring T3 Code to the front.
      </p>
      <p>
        <span className="font-medium text-foreground">Dial:</span>{" "}
        {dialMode === "scroll"
          ? "turn to scroll the conversation, press to jump to the latest message,"
          : "turn to move between threads, press to open the one that needs you,"}{" "}
        hold for these settings.
      </p>
      <p>
        <span className="font-medium text-foreground">Stick:</span> {stick}.
      </p>
    </div>
  );
}

function KeyTextDialog({
  initialText,
  onClose,
  onSave,
}: {
  readonly initialText: string;
  readonly onClose: () => void;
  readonly onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const save = () => {
    if (text.length > 0) onSave(text);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Insert text</DialogTitle>
          <DialogDescription>
            Pressing this key adds the text to the open thread's message without sending it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Input
              aria-label="Text to insert"
              placeholder=":yolo:"
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
            />
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={text.length === 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** The pad as it sits on the desk, lit the way the hardware is. */
function PadDiagram({
  keyActions,
  keyTexts,
  splitWideKey,
  assignable,
  onKeyActionChange,
  onAssignAgentKey,
}: {
  readonly keyActions: CodexMicroKeyActions;
  readonly keyTexts: CodexMicroKeyTexts;
  readonly splitWideKey: boolean;
  /** Agent Keys take a chosen thread instead of following the inbox. */
  readonly assignable: boolean;
  readonly onKeyActionChange: (key: CodexMicroActionKey, action: CodexMicroKeyAction) => void;
  readonly onAssignAgentKey: (index: number, threadKey: string | null) => void;
}) {
  const pressedKeys = useCodexMicroStore((state) => state.pressedKeys);
  const agentKeys = useCodexMicroStore((state) => state.agentKeys);
  const threads = useThreadShells();
  const nowMinute = useNowMinute();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threadByKey = useMemo(
    () => new Map(threads.map((thread) => [agentKeyThreadKey(thread), thread] as const)),
    [threads],
  );
  const choices = useMemo(
    () =>
      assignable
        ? rankAgentKeyThreads(threads, `${nowMinute}:00.000Z`).map((thread) => ({
            threadKey: agentKeyThreadKey(thread),
            title: thread.title,
          }))
        : [],
    [assignable, nowMinute, threads],
  );
  const dialPressed = ["ENC_CLK", "ENC_CW", "ENC_CC"].some((key) => pressedKeys.has(key));
  const agentKey = (index: number) => {
    const threadKey = agentKeys[index] ?? null;
    const thread = threadKey === null ? undefined : threadByKey.get(threadKey);
    return (
      <AgentKey
        key={index}
        index={index}
        title={thread?.title ?? null}
        state={
          thread === undefined || threadKey === null
            ? null
            : resolveAgentKeyState(thread, lastVisitedById[threadKey])
        }
        pressed={pressedKeys.has(`AG0${index}`)}
        assignment={
          assignable
            ? {
                threadKey,
                choices,
                onChange: (next) => onAssignAgentKey(index, next),
              }
            : null
        }
      />
    );
  };
  const actionKey = (key: CodexMicroActionKey, wide = false) => (
    <ActionKey
      key={key}
      wide={wide}
      label={codexMicroKeyLabel(keyActions[key], keyTexts[key])}
      action={keyActions[key]}
      pressed={
        pressedKeys.has(key) || (!splitWideKey && key === "ACT10" && pressedKeys.has("ACT11"))
      }
      onChange={(action) => onKeyActionChange(key, action)}
    />
  );
  return (
    <div
      role="group"
      aria-label="Codex Micro keys"
      className="grid w-fit shrink-0 grid-cols-[repeat(4,4rem)] gap-2 rounded-2xl border bg-muted/40 p-3"
    >
      <PadRound label="Dial" pressed={dialPressed} />
      {agentKey(0)}
      {agentKey(1)}
      <PadRound label="Stick" pressed={pressedKeys.has("JOYSTICK")} />
      {[2, 3, 4, 5].map(agentKey)}
      {actionKey("ACT06")}
      {actionKey("ACT07")}
      {actionKey("ACT08")}
      {actionKey("ACT09")}
      <div aria-hidden className="flex items-center justify-center">
        <span className="size-6 rounded-full border border-dashed border-foreground/20" />
      </div>
      {splitWideKey ? (
        <>
          {actionKey("ACT10")}
          {actionKey("ACT11")}
        </>
      ) : (
        actionKey("ACT10", true)
      )}
      {actionKey("ACT12")}
    </div>
  );
}

function pressedClassName(pressed: boolean) {
  return pressed ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined;
}

function PadRound({ label, pressed }: { readonly label: string; readonly pressed: boolean }) {
  return (
    <div className="flex size-16 items-center justify-center">
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full border bg-background text-2xs text-muted-foreground",
          pressedClassName(pressed),
        )}
      >
        {label}
      </span>
    </div>
  );
}

function AgentKey({
  index,
  title,
  state,
  pressed,
  assignment,
}: {
  readonly index: number;
  readonly title: string | null;
  readonly state: AgentKeyState | null;
  readonly pressed: boolean;
  readonly assignment: {
    readonly threadKey: string | null;
    readonly choices: ReadonlyArray<{ readonly threadKey: string; readonly title: string }>;
    readonly onChange: (threadKey: string | null) => void;
  } | null;
}) {
  const color = state === null ? null : cssColor(AGENT_KEY_COLORS[state]);
  const summary =
    title === null || state === null
      ? "No thread on this key"
      : `${title} · ${AGENT_KEY_STATE_LABELS[state]}`;
  const className = cn(
    "flex size-16 items-end rounded-lg border p-1.5 text-left",
    color === null && "border-dashed",
    pressedClassName(pressed),
  );
  const style =
    color === null
      ? undefined
      : { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` };
  const titleText = (
    <span className="line-clamp-2 text-2xs leading-tight text-foreground/80">{title}</span>
  );
  if (assignment !== null) {
    return (
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`Agent Key ${index + 1}: ${summary}. Choose a thread`}
              className={cn(
                className,
                "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              )}
              style={style}
            />
          }
        >
          {titleText}
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup
            value={assignment.threadKey ?? NO_THREAD}
            onValueChange={(value) => assignment.onChange(value === NO_THREAD ? null : value)}
          >
            <MenuGroup>
              <MenuGroupLabel>Agent Key {index + 1}</MenuGroupLabel>
              {assignment.choices.map((choice) => (
                <MenuRadioItem key={choice.threadKey} closeOnClick value={choice.threadKey}>
                  <span className="max-w-64 truncate">{choice.title}</span>
                </MenuRadioItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuRadioItem closeOnClick value={NO_THREAD}>
              No thread
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={`Agent Key ${index + 1}: ${summary}`}
            className={className}
            style={style}
          />
        }
      >
        {titleText}
      </TooltipTrigger>
      <TooltipPopup side="top">{summary}</TooltipPopup>
    </Tooltip>
  );
}

function ActionKey({
  action,
  label,
  wide,
  pressed,
  onChange,
}: {
  readonly action: CodexMicroKeyAction;
  readonly label: string;
  readonly wide: boolean;
  readonly pressed: boolean;
  readonly onChange: (action: CodexMicroKeyAction) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Action key: ${label}. Change action`}
            className={cn(
              "flex h-16 items-center justify-center rounded-lg border bg-background px-1.5 text-center text-xs font-medium shadow-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              wide ? "col-span-2" : "w-16",
              action === "none" && "text-muted-foreground",
              pressedClassName(pressed),
            )}
          />
        }
      >
        <span className="line-clamp-2 wrap-break-word">{label}</span>
      </MenuTrigger>
      <MenuPopup align="center">
        <MenuRadioGroup
          value={action}
          onValueChange={(value) => {
            const next = asKeyAction(value);
            if (next !== undefined) onChange(next);
          }}
        >
          {CODEX_MICRO_ACTION_GROUPS.map((group) => (
            <MenuGroup key={group.label}>
              <MenuGroupLabel>{group.label}</MenuGroupLabel>
              {group.actions.map((candidate) =>
                // A plain item, so choosing it again reopens the text editor.
                candidate === "insert-text" ? (
                  <MenuItem key={candidate} closeOnClick onClick={() => onChange(candidate)}>
                    Insert text…
                  </MenuItem>
                ) : (
                  <MenuRadioItem key={candidate} closeOnClick value={candidate}>
                    {CODEX_MICRO_KEY_ACTION_LABELS[candidate]}
                  </MenuRadioItem>
                ),
              )}
            </MenuGroup>
          ))}
          <MenuSeparator />
          <MenuRadioItem closeOnClick value="none">
            {CODEX_MICRO_KEY_ACTION_LABELS.none}
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
