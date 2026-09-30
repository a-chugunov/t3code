/**
 * Wire format of the Codex Micro's vendor HID channel.
 *
 * The pad's keys emit no ordinary scancodes and its LEDs are not standard HID
 * lighting. Both ride one vendor collection (usage page 0xFF00, report 6) that
 * carries CRLF-terminated JSON-RPC, split across 63-byte reports laid out as
 * `[0x02][length][bytes…]`. FreeMicro reverse engineered the channel
 * (https://github.com/eliBenven/freemicro/blob/main/docs/PROTOCOL.md); what is
 * used here was re-checked against firmware 0.6.2.
 *
 * WebHID always sends the report id ahead of the payload. That is the framing
 * Bluetooth requires, and USB accepts it too, so one encoding serves both
 * links. A malformed write still resolves and is silently dropped by the pad,
 * so only a `device.status` reply proves the channel works.
 *
 * The pad reassembles every writer's reports into one line buffer. A message
 * cut short (a page unloading mid-write, or the ChatGPT app writing at the
 * same time) leaves a partial line that swallows the next request, so each
 * message starts with its own CRLF; the pad ignores the empty line.
 */
import * as Schema from "effect/Schema";

export const CODEX_MICRO_VENDOR_ID = 0x303a;
export const CODEX_MICRO_PRODUCT_ID = 0x8360;
export const CODEX_MICRO_USAGE_PAGE = 0xff00;
export const CODEX_MICRO_REPORT_ID = 6;

const REPORT_BYTES = 63;
const DATA_OPCODE = 0x02;
const CHUNK_BYTES = REPORT_BYTES - 2;
// A line longer than this is garbage; drop it rather than buffer forever.
const MAX_PENDING_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Splits one JSON-RPC message into the output reports that carry it. */
export function encodePadMessage(message: unknown): Uint8Array<ArrayBuffer>[] {
  const bytes = textEncoder.encode(`\r\n${JSON.stringify(message)}\r\n`);
  const reports: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    const report = new Uint8Array(REPORT_BYTES);
    report[0] = DATA_OPCODE;
    report[1] = chunk.length;
    report.set(chunk, 2);
    reports.push(report);
  }
  return reports;
}

/**
 * Reassembles messages from input reports. One message can span several
 * reports, so bytes are buffered until a CRLF ends the line.
 */
export class PadMessageDecoder {
  private pending = new Uint8Array(0);

  feed(report: Uint8Array): unknown[] {
    // WebHID strips the report id; tolerate a host that keeps it.
    const start = report[0] === CODEX_MICRO_REPORT_ID && report[1] === DATA_OPCODE ? 1 : 0;
    if (report[start] !== DATA_OPCODE) return [];
    const length = Math.min(report[start + 1] ?? 0, report.length - start - 2);
    const next = new Uint8Array(this.pending.length + length);
    next.set(this.pending);
    next.set(report.subarray(start + 2, start + 2 + length), this.pending.length);

    const messages: unknown[] = [];
    let lineStart = 0;
    for (let index = 0; index < next.length - 1; index++) {
      if (next[index] !== 0x0d || next[index + 1] !== 0x0a) continue;
      const line = textDecoder.decode(next.subarray(lineStart, index)).trim();
      lineStart = index + 2;
      index++;
      if (line.length === 0) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // A garbled line is not fatal; the next one starts clean.
      }
    }
    const rest = next.slice(lineStart);
    this.pending = rest.length > MAX_PENDING_BYTES ? new Uint8Array(0) : rest;
    return messages;
  }
}

/** Methods the pad answers. `v.oai.*` lighting calls are notifications and 404 when given an id. */
export function padRequest(id: number, method: string) {
  return { m: method, id };
}

export function padNotification(method: string, params: unknown) {
  return { m: method, p: params };
}

export const CodexMicroStatus = Schema.Struct({
  version: Schema.String,
  battery: Schema.Number,
  is_charging: Schema.Boolean,
});
export type CodexMicroStatus = typeof CodexMicroStatus.Type;

const PadEnvelope = Schema.Struct({
  m: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  p: Schema.optional(Schema.Unknown),
  params: Schema.optional(Schema.Unknown),
  id: Schema.optional(Schema.NullOr(Schema.Number)),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
});
const isPadEnvelope = Schema.is(PadEnvelope);
const isKeyParams = Schema.is(Schema.Struct({ k: Schema.String, act: Schema.Number }));
const isJoystickParams = Schema.is(Schema.Struct({ a: Schema.Finite, d: Schema.Finite }));

export type PadEvent =
  /** Key ids: AG00-AG05, ACT06-ACT12, ENC_CLK, and the dial detents ENC_CW / ENC_CC. */
  | { readonly type: "key"; readonly key: string; readonly phase: "down" | "up" | "tick" }
  /** Thumbstick position; both values run 0-1 and rest at exactly 0. */
  | { readonly type: "joystick"; readonly angle: number; readonly distance: number }
  | { readonly type: "reply"; readonly id: number; readonly result: unknown }
  | { readonly type: "error"; readonly id: number };

/** What the person did on the pad, as opposed to replies to T3 Code. */
export type PadInputEvent = Extract<PadEvent, { readonly type: "key" | "joystick" }>;

export function readPadEvent(message: unknown): PadEvent | null {
  if (!isPadEnvelope(message)) return null;
  const method = message.m ?? message.method;
  const params = message.p ?? message.params;
  if (method === "v.oai.hid" && isKeyParams(params)) {
    // Dial detents carry assorted `act` values and never a release.
    if (params.k === "ENC_CW" || params.k === "ENC_CC") {
      return { type: "key", key: params.k, phase: "tick" };
    }
    if (params.act === 1) return { type: "key", key: params.k, phase: "down" };
    if (params.act === 0) return { type: "key", key: params.k, phase: "up" };
    return null;
  }
  if (method === "v.oai.rad" && isJoystickParams(params)) {
    return { type: "joystick", angle: params.a, distance: params.d };
  }
  if (typeof message.id === "number") {
    if (message.error !== undefined && message.error !== null) {
      return { type: "error", id: message.id };
    }
    if ("result" in message) return { type: "reply", id: message.id, result: message.result };
  }
  return null;
}
