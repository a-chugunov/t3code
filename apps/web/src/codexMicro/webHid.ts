/**
 * The slice of WebHID (https://wicg.github.io/webhid/) the pad uses.
 * TypeScript's DOM lib does not ship it. Chromium browsers and the desktop app
 * expose it in secure contexts; Safari and Firefox do not.
 */
import { CODEX_MICRO_PRODUCT_ID, CODEX_MICRO_USAGE_PAGE, CODEX_MICRO_VENDOR_ID } from "./protocol";

export interface HidDevice extends EventTarget {
  readonly opened: boolean;
  readonly productName: string;
  readonly vendorId: number;
  readonly productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

export interface HidInputReportEvent extends Event {
  readonly reportId: number;
  readonly data: DataView;
}

export interface HidConnectionEvent extends Event {
  readonly device: HidDevice;
}

export interface Hid extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: {
    readonly filters: ReadonlyArray<{
      readonly vendorId: number;
      readonly productId: number;
      readonly usagePage: number;
    }>;
  }): Promise<HidDevice[]>;
}

export function getWebHid(): Hid | null {
  if (typeof navigator === "undefined" || !("hid" in navigator)) return null;
  return (navigator as Navigator & { readonly hid: Hid }).hid;
}

export const CODEX_MICRO_HID_FILTER = {
  vendorId: CODEX_MICRO_VENDOR_ID,
  productId: CODEX_MICRO_PRODUCT_ID,
  usagePage: CODEX_MICRO_USAGE_PAGE,
};

export function isCodexMicro(device: HidDevice): boolean {
  return device.vendorId === CODEX_MICRO_VENDOR_ID && device.productId === CODEX_MICRO_PRODUCT_ID;
}

export type CodexMicroTransport = "usb" | "bluetooth";

/** Over Bluetooth the pad names itself after its host slot, "Codex Micro #1" to "#3". */
export function codexMicroTransport(productName: string): CodexMicroTransport {
  return /#\d+$/.test(productName.trim()) ? "bluetooth" : "usb";
}
