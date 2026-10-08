import { Channel, invoke } from "@tauri-apps/api/core";
import { invokeOr, isRecord } from "./wire";

/** What to scan, as `start_scan` in `crates/gui/src/scan.rs` takes it. */
export type ScanRequest = {
    paths: string[];
    /** From 0 to 1. */
    threshold: number;
    /** Whether each frame is also compared rotated. */
    rotate: boolean;
    /** Whether each frame is also compared flipped. */
    flip: boolean;
};

/** What a running scan reports, as `ScanMessage` in `crates/gui/src/scan.rs` serializes it. */
export type ScanMessage =
    | {
          kind: "processing";
          path: string;
          /** The path as the set list shows it, with `~` for the home folder on macOS and Linux. */
          display: string;
      }
    | {
          kind: "progress";
          /** The files done, skipped ones included. */
          done: number;
          total: number;
          /** The files that couldn't be read. */
          skipped: number;
          /** The estimated time left, in seconds, once there is one. */
          etaSeconds?: number;
      };

/** A file the scan skipped because it couldn't be read. */
export type SkippedFile = { path: string; message: string };

/** What a finished scan resolves to. */
export type ScanResult = {
    /** The groups of similar files, as paths, each group and the groups in path order. */
    groups: string[][];
    /** In the order the paths were given. */
    skipped: SkippedFile[];
};

/** Why a scan ended without a result, as `ScanFailure` in `crates/gui/src/scan.rs` serializes it. */
export type ScanFailure = { kind: "cancelled" } | { kind: "task"; message: string };

type ProgressMessage = Extract<ScanMessage, { kind: "progress" }>;

/** {@link ScanMessage} as it arrives, with an absent estimate as JSON `null`. */
type WireScanMessage =
    | Exclude<ScanMessage, ProgressMessage>
    | (Omit<ProgressMessage, "etaSeconds"> & { etaSeconds: number | null });

/** `message` with Rust's `None` spelled as an absent property, as this project does. */
const fromWire = (message: WireScanMessage): ScanMessage => {
    if (message.kind === "processing") return message;

    const { etaSeconds, ...always } = message;
    return { ...always, ...(etaSeconds !== null && { etaSeconds }) };
};

/**
 * Start a scan of `request.paths`, calling `onMessage` with its progress, and resolve to its groups. Starting a scan
 * cancels any earlier one still running, which then rejects as `cancelled`. Rejects with a {@link ScanFailure}.
 */
export const startScan = (request: ScanRequest, onMessage: (message: ScanMessage) => void): Promise<ScanResult> => {
    const onEvent = new Channel<WireScanMessage>((message) => onMessage(fromWire(message)));

    return call<ScanResult>("start_scan", { ...request, onEvent });
};

/** Cancel the scan in flight, if any. */
export const cancelScan = () => invoke<void>("cancel_scan");

/** The {@link ScanFailure} a rejection carries, or a `task` failure for anything else, such as a missing command. */
const toFailure = (error: unknown): ScanFailure => {
    if (isRecord(error)) {
        const { kind, message } = error;
        if (kind === "cancelled") {
            return { kind };
        }
        if (kind === "task" && typeof message === "string") {
            return { kind, message };
        }
    }

    return { kind: "task", message: String(error) };
};

const call = invokeOr(toFailure);
