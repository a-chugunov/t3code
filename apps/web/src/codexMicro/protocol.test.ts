import { describe, expect, it } from "vite-plus/test";

import { encodePadMessage, PadMessageDecoder, padNotification, readPadEvent } from "./protocol";

function decodeAll(reports: ReadonlyArray<Uint8Array>): unknown[] {
  const decoder = new PadMessageDecoder();
  return reports.flatMap((report) => decoder.feed(report));
}

describe("encodePadMessage", () => {
  it("frames a short message as one 63-byte report", () => {
    const [report, ...rest] = encodePadMessage({ m: "device.status", id: 1 });
    const json = '\r\n{"m":"device.status","id":1}\r\n';

    expect(rest).toEqual([]);
    expect(report?.length).toBe(63);
    expect(report?.[0]).toBe(0x02);
    expect(report?.[1]).toBe(json.length);
    expect(new TextDecoder().decode(report?.subarray(2, 2 + json.length))).toBe(json);
  });

  it("splits long messages at 61 bytes of payload", () => {
    const message = padNotification(
      "v.oai.thstatus",
      Array.from({ length: 6 }, (_, id) => ({ id, c: 0x304ffe, b: 1, e: 1, s: 0, sk: 0, sa: 0 })),
    );
    const reports = encodePadMessage(message);

    expect(reports.length).toBeGreaterThan(1);
    expect(reports.slice(0, -1).every((report) => report[1] === 61)).toBe(true);
    expect(decodeAll(reports)).toEqual([message]);
  });
});

describe("PadMessageDecoder", () => {
  it("reassembles a reply split across reports, with or without the report id", () => {
    const reply = {
      result: { version: "0.6.2", battery: 72, is_charging: true },
      id: 7,
      method: "device.status",
    };
    const reports = encodePadMessage(reply);
    const withReportId = reports.map((report) => Uint8Array.of(6, ...report));

    expect(decodeAll(reports)).toEqual([reply]);
    expect(decodeAll(withReportId)).toEqual([reply]);
  });

  it("skips a garbled line and keeps decoding", () => {
    const garbage = new TextEncoder().encode("{not json\r\n");
    const report = new Uint8Array(63);
    report.set([0x02, garbage.length, ...garbage]);
    const next = encodePadMessage({ m: "v.oai.hid", p: { k: "AG00", act: 1 } });

    expect(decodeAll([report, ...next])).toEqual([{ m: "v.oai.hid", p: { k: "AG00", act: 1 } }]);
  });
});

describe("readPadEvent", () => {
  it("reads key presses and releases", () => {
    expect(readPadEvent({ m: "v.oai.hid", p: { k: "ACT07", act: 1, ag: 0 } })).toEqual({
      type: "key",
      key: "ACT07",
      phase: "down",
    });
    expect(readPadEvent({ method: "v.oai.hid", params: { k: "ACT07", act: 0 } })).toEqual({
      type: "key",
      key: "ACT07",
      phase: "up",
    });
  });

  it("treats every dial detent as a tick, whatever its act value", () => {
    expect(readPadEvent({ m: "v.oai.hid", p: { k: "ENC_CW", act: 2 } })).toEqual({
      type: "key",
      key: "ENC_CW",
      phase: "tick",
    });
    expect(readPadEvent({ m: "v.oai.hid", p: { k: "ENC_CC", act: 1 } })).toEqual({
      type: "key",
      key: "ENC_CC",
      phase: "tick",
    });
  });

  it("reads the thumbstick and request replies", () => {
    expect(readPadEvent({ m: "v.oai.rad", p: { a: 0.75, d: 0.9 } })).toEqual({
      type: "joystick",
      angle: 0.75,
      distance: 0.9,
    });
    expect(readPadEvent({ result: { version: "0.6.2" }, id: 3 })).toEqual({
      type: "reply",
      id: 3,
      result: { version: "0.6.2" },
    });
    expect(readPadEvent({ error: { code: 404, message: "Method not found" }, id: 4 })).toEqual({
      type: "error",
      id: 4,
    });
    expect(readPadEvent({ result: { ok: 1 }, id: null, method: "v.oai.rgbcfg" })).toBeNull();
  });
});
