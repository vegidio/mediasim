import { Channel, invoke } from "@tauri-apps/api/core";
import type { MediaType } from "./formats";
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

/** A grouped file's metadata, as `Media` in `mediasim` serializes it. */
export type GroupFile = {
    path: string;
    type: MediaType;
    width: number;
    height: number;
    /** In bytes. */
    size: number;
    /** In seconds; videos only. */
    duration?: number;
    /** RFC 3339, in UTC, when the filesystem records it. */
    created?: string;
    /** RFC 3339, in UTC, when the filesystem records it. */
    modified?: string;
};

/** A group of similar files. */
export type ScanGroup = {
    /** In path order. */
    files: GroupFile[];
};

/** What a finished scan resolves to. */
export type ScanResult = {
    /** The groups of similar files, in the order of the paths given. */
    groups: ScanGroup[];
    /** In the order the paths were given. */
    skipped: SkippedFile[];
};

/** Why a scan ended without a result, as `ScanFailure` in `crates/gui/src/scan.rs` serializes it. */
export type ScanFailure = { kind: "cancelled" } | { kind: "task"; message: string };

type OptionalKey = "duration" | "created" | "modified";

/** {@link GroupFile} as it arrives, with each absent value as JSON `null`. */
type WireGroupFile = Omit<GroupFile, OptionalKey> & { [K in OptionalKey]-?: NonNullable<GroupFile[K]> | null };

/** {@link ScanResult} as it arrives. */
type WireScanResult = Omit<ScanResult, "groups"> & {
    groups: (Omit<ScanGroup, "files"> & { files: WireGroupFile[] })[];
};

/** `file` with Rust's `None` spelled as an absent property. */
const fileFromWire = ({ duration, created, modified, ...always }: WireGroupFile): GroupFile => ({
    ...always,
    ...(duration !== null && { duration }),
    ...(created !== null && { created }),
    ...(modified !== null && { modified }),
});

const resultFromWire = ({ groups, skipped }: WireScanResult): ScanResult => ({
    groups: groups.map(({ files }) => ({ files: files.map(fileFromWire) })),
    skipped,
});

/**
 * Start a scan of `request.paths`, calling `onMessage` with its progress, and resolve to its groups. Starting a scan
 * cancels any earlier one still running, which then rejects as `cancelled`. Rejects with a {@link ScanFailure}.
 */
export const startScan = async (
    request: ScanRequest,
    onMessage: (message: ScanMessage) => void,
): Promise<ScanResult> => {
    const onEvent = new Channel<ScanMessage>(onMessage);

    return resultFromWire(await call<WireScanResult>("start_scan", { ...request, onEvent }));
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
