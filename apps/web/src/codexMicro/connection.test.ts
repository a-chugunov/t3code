import { describe, expect, it } from "vite-plus/test";

import { CodexMicroConnection } from "./connection";
import { buildPadLighting } from "./lighting";
import { encodePadMessage, PadMessageDecoder } from "./protocol";
import type { HidDevice } from "./webHid";

/** Records what T3 Code writes and lets the test answer as the pad. */
class FakePad extends EventTarget implements HidDevice {
  readonly opened = true;
  readonly productName = "Codex Micro";
  readonly vendorId = 0x303a;
  readonly productId = 0x8360;
  readonly sent: unknown[] = [];
  private readonly decoder = new PadMessageDecoder();
  reply: ((request: { readonly m: string; readonly id?: number }) => unknown) | null = null;
  /** macOS refuses writes to keyboard-class devices while the screen is locked. */
  refuse = false;

  async open() {}
  async close() {}

  async sendReport(reportId: number, data: BufferSource) {
    if (this.refuse) throw new DOMException("Failed to write the report.", "NotAllowedError");
    expect(reportId).toBe(6);
    const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
    for (const message of this.decoder.feed(bytes)) {
      this.sent.push(message);
      const response = this.reply?.(message as { m: string; id?: number });
      if (response !== undefined) queueMicrotask(() => this.emit(response));
    }
  }

  emit(message: unknown) {
    for (const report of encodePadMessage(message)) {
      const event = new Event("inputreport");
      Object.assign(event, { reportId: 6, data: new DataView(report.buffer) });
      this.dispatchEvent(event);
    }
  }
}

const frame = (state: "idle" | "working") =>
  buildPadLighting({
    keys: [{ state, selected: false }],
    brightness: 1,
    openThreadState: null,
    flashing: false,
  });

describe("CodexMicroConnection", () => {
  it("pairs device.status with its reply", async () => {
    const pad = new FakePad();
    pad.reply = (request) =>
      request.m === "device.status"
        ? { result: { version: "0.6.2", battery: 72, is_charging: true }, id: request.id }
        : undefined;
    const connection = new CodexMicroConnection(pad, () => {});

    await expect(connection.status()).resolves.toEqual({
      version: "0.6.2",
      battery: 72,
      is_charging: true,
    });
  });

  it("writes only the lighting that changed", async () => {
    const pad = new FakePad();
    const connection = new CodexMicroConnection(pad, () => {});

    await connection.applyLighting(frame("idle"));
    await connection.applyLighting(frame("idle"));
    await connection.applyLighting(frame("working"));

    expect(pad.sent.map((message) => (message as { m: string }).m)).toEqual([
      "v.oai.rgbcfg",
      "v.oai.thstatus",
      "v.oai.thstatus",
    ]);
  });

  it("flags refused writes and repaints in full once writes land again", async () => {
    const pad = new FakePad();
    pad.reply = (request) =>
      request.m === "device.status"
        ? { result: { version: "0.6.2", battery: 72, is_charging: false }, id: request.id }
        : undefined;
    const connection = new CodexMicroConnection(pad, () => {});
    await connection.applyLighting(frame("idle"));

    pad.refuse = true;
    await expect(connection.status()).resolves.toBeNull();
    expect(connection.writesRefused).toBe(true);

    pad.refuse = false;
    await expect(connection.status()).resolves.not.toBeNull();
    expect(connection.writesRefused).toBe(false);
    connection.forgetLighting();
    pad.sent.length = 0;
    await connection.applyLighting(frame("idle"));
    expect(pad.sent.map((message) => (message as { m: string }).m)).toEqual([
      "v.oai.rgbcfg",
      "v.oai.thstatus",
    ]);
  });

  it("hands key and stick input to its listener", () => {
    const pad = new FakePad();
    const events: unknown[] = [];
    const connection = new CodexMicroConnection(pad, (event) => events.push(event));

    pad.emit({ m: "v.oai.hid", p: { k: "ACT07", act: 1, ag: 0 } });
    pad.emit({ m: "v.oai.rad", p: { a: 0.25, d: 0.7 } });

    expect(events).toEqual([
      { type: "key", key: "ACT07", phase: "down" },
      { type: "joystick", angle: 0.25, distance: 0.7 },
    ]);
    void connection.close();
  });
});
