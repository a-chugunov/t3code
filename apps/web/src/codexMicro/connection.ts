import * as Schema from "effect/Schema";

import type { PadLighting } from "./lighting";
import {
  CODEX_MICRO_REPORT_ID,
  CodexMicroStatus,
  encodePadMessage,
  PadMessageDecoder,
  padNotification,
  padRequest,
  readPadEvent,
  type PadInputEvent,
} from "./protocol";
import type { HidDevice, HidInputReportEvent } from "./webHid";

const REQUEST_TIMEOUT_MS = 2_000;
const isCodexMicroStatus = Schema.is(CodexMicroStatus);

/**
 * One open pad. Writes go out one at a time, lighting that would not change
 * anything is skipped (the firmware repaints on every write, so repeats
 * flicker), and replies are matched to their requests by id.
 */
export class CodexMicroConnection {
  private readonly decoder = new PadMessageDecoder();
  private readonly pending = new Map<number, (result: unknown) => void>();
  private writes: Promise<void> = Promise.resolve();
  private nextRequestId = 1;
  private appliedGlow: string | null = null;
  private appliedAgentKeys: string | null = null;
  /**
   * The OS rejected the last write. macOS refuses writes to the pad (it
   * enumerates as a keyboard) while the screen is locked.
   */
  writesRefused = false;

  constructor(
    readonly device: HidDevice,
    private readonly onEvent: (event: PadInputEvent) => void,
  ) {
    device.addEventListener("inputreport", this.handleReport);
  }

  private readonly handleReport = (event: Event) => {
    const { reportId, data } = event as HidInputReportEvent;
    if (reportId !== CODEX_MICRO_REPORT_ID) return;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (const message of this.decoder.feed(bytes)) {
      const padEvent = readPadEvent(message);
      if (padEvent === null) continue;
      if (padEvent.type === "reply" || padEvent.type === "error") {
        const resolve = this.pending.get(padEvent.id);
        this.pending.delete(padEvent.id);
        resolve?.(padEvent.type === "reply" ? padEvent.result : null);
        continue;
      }
      this.onEvent(padEvent);
    }
  };

  private write(message: unknown): Promise<void> {
    const next = this.writes.then(async () => {
      for (const report of encodePadMessage(message)) {
        await this.device.sendReport(CODEX_MICRO_REPORT_ID, report);
      }
    });
    this.writes = next.then(
      () => {
        this.writesRefused = false;
      },
      () => {
        this.writesRefused = true;
      },
    );
    return next;
  }

  /** The pad may have lost its lights (a refused write, say); send them in full next time. */
  forgetLighting(): void {
    this.appliedGlow = null;
    this.appliedAgentKeys = null;
  }

  /** Battery and firmware. A reply is also the only proof that writes reach the pad. */
  async status(): Promise<CodexMicroStatus | null> {
    const id = this.nextRequestId++;
    const reply = new Promise<unknown>((resolve) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null);
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      await this.write(padRequest(id, "device.status"));
    } catch {
      this.pending.delete(id);
      return null;
    }
    const result = await reply;
    return isCodexMicroStatus(result) ? result : null;
  }

  async applyLighting(lighting: PadLighting): Promise<void> {
    const glow = JSON.stringify(lighting.glow);
    const agentKeys = JSON.stringify(lighting.agentKeys);
    const writes: Promise<void>[] = [];
    if (glow !== this.appliedGlow) {
      this.appliedGlow = glow;
      writes.push(this.write(padNotification("v.oai.rgbcfg", lighting.glow)));
    }
    if (agentKeys !== this.appliedAgentKeys) {
      this.appliedAgentKeys = agentKeys;
      writes.push(this.write(padNotification("v.oai.thstatus", lighting.agentKeys)));
    }
    try {
      await Promise.all(writes);
    } catch (error) {
      this.forgetLighting();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.handleReport);
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
    await this.writes;
    await this.device.close().catch(() => undefined);
  }
}
