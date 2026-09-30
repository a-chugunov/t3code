import {
  CODEX_MICRO_KEY_ACTIONS,
  CodexMicroAutoDimSeconds,
  DEFAULT_CLIENT_SETTINGS,
  type CodexMicroActionKey,
  type CodexMicroKeyAction,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useMemo, type CSSProperties } from "react";

import {
  agentKeyThreadKey,
  resolveAgentKeyState,
  type AgentKeyState,
} from "../../codexMicro/agentKeys";
import { useCodexMicroStore } from "../../codexMicro/codexMicroStore";
import { AGENT_KEY_COLORS } from "../../codexMicro/lighting";
import { CODEX_MICRO_HID_FILTER, getWebHid } from "../../codexMicro/webHid";
import { isElectron } from "../../env";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { cn, isMacPlatform } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AGENT_KEY_STATE_LABELS,
  CODEX_MICRO_AUTO_DIM_LABELS,
  CODEX_MICRO_KEY_ACTION_LABELS,
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
const AGENT_KEY_STATES: ReadonlyArray<AgentKeyState> = [
  "idle",
  "working",
  "attention",
  "unread",
  "error",
];

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
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
  const updateSettings = useUpdateClientSettings();
  const pad = useCodexMicroStore((state) => state.pad);
  const mac = isMacPlatform(navigator.platform);
  const brightnessSliderStyle = {
    "--settings-slider-progress": `${((brightness - 10) / 90) * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - (brightness - 10) / 90}rem`,
  } as CSSProperties;

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
            description="The Agent Keys hold your first six pinned and active threads, and each keeps its key while it stays there. While this page is open, pressing a key on the pad only lights it up here, so you can find it before choosing what it does."
          >
            <div className="flex flex-col gap-4 pt-2 pb-3 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-start">
              <PadDiagram
                keyActions={keyActions}
                onKeyActionChange={(key, action) =>
                  updateSettings({ codexMicroKeyActions: { ...keyActions, [key]: action } })
                }
              />
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
                  <span className="font-medium text-foreground">Tap</span> an Agent Key to open its
                  thread. Tap twice to bring T3 Code to the front.
                </p>
                <p>
                  <span className="font-medium text-foreground">Dial:</span> turn to move between
                  threads, press to open the one that needs you, hold for these settings.
                </p>
                <p>
                  <span className="font-medium text-foreground">Stick:</span> up opens the command
                  palette, down toggles the sidebar, left and right go back and forward.
                </p>
              </div>
            </div>
          </SettingsRow>
        ) : null}
      </SettingsSection>

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
    </SettingsPageContainer>
  );
}

/** The pad as it sits on the desk, lit the way the hardware is. */
function PadDiagram({
  keyActions,
  onKeyActionChange,
}: {
  readonly keyActions: Readonly<Record<CodexMicroActionKey, CodexMicroKeyAction>>;
  readonly onKeyActionChange: (key: CodexMicroActionKey, action: CodexMicroKeyAction) => void;
}) {
  const pressedKeys = useCodexMicroStore((state) => state.pressedKeys);
  const agentKeys = useCodexMicroStore((state) => state.agentKeys);
  const threads = useThreadShells();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threadByKey = useMemo(
    () => new Map(threads.map((thread) => [agentKeyThreadKey(thread), thread] as const)),
    [threads],
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
      />
    );
  };
  const actionKey = (key: CodexMicroActionKey, wide = false) => (
    <ActionKey
      key={key}
      wide={wide}
      action={keyActions[key]}
      pressed={pressedKeys.has(key) || (key === "ACT10" && pressedKeys.has("ACT11"))}
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
      {actionKey("ACT10", true)}
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
}: {
  readonly index: number;
  readonly title: string | null;
  readonly state: AgentKeyState | null;
  readonly pressed: boolean;
}) {
  const color = state === null ? null : cssColor(AGENT_KEY_COLORS[state]);
  const summary =
    title === null || state === null
      ? "No thread on this key"
      : `${title} · ${AGENT_KEY_STATE_LABELS[state]}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={`Agent Key ${index + 1}: ${summary}`}
            className={cn(
              "flex size-16 items-end rounded-lg border p-1.5",
              color === null && "border-dashed",
              pressedClassName(pressed),
            )}
            style={
              color === null
                ? undefined
                : {
                    borderColor: color,
                    backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
                  }
            }
          />
        }
      >
        <span className="line-clamp-2 text-2xs leading-tight text-foreground/80">{title}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{summary}</TooltipPopup>
    </Tooltip>
  );
}

function ActionKey({
  action,
  wide,
  pressed,
  onChange,
}: {
  readonly action: CodexMicroKeyAction;
  readonly wide: boolean;
  readonly pressed: boolean;
  readonly onChange: (action: CodexMicroKeyAction) => void;
}) {
  const label = CODEX_MICRO_KEY_ACTION_LABELS[action];
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
        {label}
      </MenuTrigger>
      <MenuPopup align="center">
        <MenuRadioGroup
          value={action}
          onValueChange={(value) => {
            const next = CODEX_MICRO_KEY_ACTIONS.find((candidate) => candidate === value);
            if (next !== undefined) onChange(next);
          }}
        >
          {CODEX_MICRO_KEY_ACTIONS.map((candidate) => (
            <MenuRadioItem key={candidate} closeOnClick value={candidate}>
              {CODEX_MICRO_KEY_ACTION_LABELS[candidate]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
