# Codex Micro

T3 Code can drive OpenAI's Codex Micro keypad. The six Agent Keys light up with your threads, and
the action keys, dial, and stick act on them. The pad works over USB or Bluetooth.

## Turning it on

Open **Settings** > **Codex Micro** and turn it on. The desktop app finds the pad by itself. In
Chrome or Edge, choose **Connect** and pick the pad; the browser remembers it after that. Other
browsers can't reach USB or Bluetooth devices.

Quit the ChatGPT app while T3 Code drives the pad. It drives the same lights and keys whenever it
runs, so the two would repaint the pad over each other and both would act on every press.

On macOS, if the settings page says macOS blocked the pad, allow T3 Code under **System Settings** >
**Privacy & Security** > **Input Monitoring**, then reopen T3 Code.

Turning the setting off darkens the pad and releases it. Only one T3 Code window drives the pad at a
time; another window takes over when the first one closes.

## Agent Keys

The Agent Keys hold your first six pinned and active threads, from every connected environment. A
thread keeps its key for as long as it stays among those six, so keys don't shuffle as threads
change order. Snoozed, settled, and archived threads leave the pad.

To change what they hold, use **Agent Keys** under **Controls**: **Pinned threads** keeps only your
pins, and **Threads you choose** lets you pick each key's thread from the pad picture. Giving a key
a thread that already has one swaps the two.

| Color | Meaning                                                 |
| ----- | ------------------------------------------------------- |
| White | Idle                                                    |
| Blue  | Working                                                 |
| Amber | Needs you: an approval, a question, or a plan to review |
| Green | Finished since you last opened it                       |
| Red   | Failed                                                  |

Tap a key to open its thread. Tap it twice to also bring T3 Code to the front. The open thread's
key breathes, and the glow around the pad runs blue while that thread works.

## Keys, dial, and stick

The action keys act on the open thread. Out of the box they follow the factory keycaps: Fast
mode, Approve, Decline, New thread (the SPLIT key), and Send (the CODEX key). The wide MIC key
is unassigned because T3 Code has no voice input on desktop yet.

Keycaps come off, so each key's job is set by position. Select a key on the pad picture in
settings to give it another action, such as moving between threads or opening the command palette.
**Insert text…** makes the key type a snippet into the composer without sending it. While the
settings page is open, pressing a key on the pad only lights it up on screen, so you can find a key
without setting anything off.

The wide MIC slot has two switches. If you fit two single keycaps there, turn on **Split the wide
key** to give each its own action.

- **Dial:** turn to move between threads, and press to open the thread that needs you most. Set
  **Dial** to **Scroll the conversation** to scroll the open thread instead; pressing then jumps to
  the latest message. Holding the dial always opens the Codex Micro settings.
- **Stick:** up opens the command palette, down toggles the sidebar, and left and right go back
  and forward. Each direction can take any action under **Stick**.

## Lighting

**Brightness** applies to every light on the pad. **Auto-dim** turns the lights off after three
minutes without a change; pick a different delay or **Never**. Any press, and any change to a
thread on the pad, turns them back on.
