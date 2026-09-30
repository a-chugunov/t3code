import type * as Electron from "electron";

// Keep in sync with the pad filter in apps/web/src/codexMicro/protocol.ts.
const CODEX_MICRO_VENDOR_ID = 0x303a;
const CODEX_MICRO_PRODUCT_ID = 0x8360;

const configuredSessions = new WeakSet<Electron.Session>();

// Serial ports report their ids as strings; only HID devices can match.
function isCodexMicro(device: {
  readonly vendorId?: number | string | undefined;
  readonly productId?: number | string | undefined;
}) {
  return device.vendorId === CODEX_MICRO_VENDOR_ID && device.productId === CODEX_MICRO_PRODUCT_ID;
}

/**
 * Lets the app's own pages open a Codex Micro over WebHID without a chooser, so
 * the pad reconnects on launch the way it does in a browser that remembers the
 * grant. Every other HID device, and every other origin, stays unavailable.
 */
export function allowCodexMicroHid(session: Electron.Session, appOrigin: string): void {
  if (configuredSessions.has(session)) return;
  configuredSessions.add(session);
  session.setDevicePermissionHandler(
    (details) =>
      details.deviceType === "hid" && details.origin === appOrigin && isCodexMicro(details.device),
  );
  session.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const pad =
      details.frame?.origin === appOrigin ? details.deviceList.find(isCodexMicro) : undefined;
    callback(pad?.deviceId ?? null);
  });
}
