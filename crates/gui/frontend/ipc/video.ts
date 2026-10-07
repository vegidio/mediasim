import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** The URI scheme `crates/gui/src/video/mod.rs` serves videos over. */
const SCHEME = "video";

/**
 * The address of an admitted video, for a `<video>`: the file's own bytes, answered in byte ranges. `convertFileSrc`
 * picks the platform's form, `video://localhost/…` or `http://video.localhost/…`.
 */
export const videoUrl = (identity: string) => convertFileSrc(identity, SCHEME);

/** One main stream's codec, as `crates/gui/src/video/probe.rs` reads it. */
export type StreamProbe = {
    /** FFmpeg's name for the codec, such as `h264`. */
    codec: string;
    /** The RFC 6381 codec string, such as `avc1.640028`, when FFmpeg has one. */
    codecString?: string;
};

/** What an admitted video holds, read from its header by `probe_video`. */
export type VideoProbe = {
    /** The demuxer's name for the container, such as `matroska,webm` or `mov,mp4,m4a,3gp,3g2,mj2`. */
    format: string;
    /** In seconds. */
    duration: number;
    video?: StreamProbe;
    audio?: StreamProbe;
};

/** A remux session just opened. */
export type RemuxOpened = {
    session: number;
    /** The time, in seconds, the session starts from: the last keyframe at or before the time asked. */
    start: number;
};

/** Why a probe or a remux request was refused, as `RemuxError` in `crates/gui/src/video/error.rs` serializes it. */
export type RemuxError = { kind: "notfound" } | { kind: "gone" } | { kind: "unreadable"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The {@link RemuxError} a rejection carries, or an `unreadable` one for anything else, such as a missing command. */
const toRemuxError = (error: unknown): RemuxError => {
    if (isRecord(error)) {
        const { kind, message } = error;
        if (kind === "notfound" || kind === "gone") return { kind };
        if (kind === "unreadable" && typeof message === "string") return { kind, message };
    }

    return { kind: "unreadable", message: String(error) };
};

const call = <T>(command: string, args: Record<string, unknown>): Promise<T> =>
    invoke<T>(command, args).catch((error: unknown) => {
        throw toRemuxError(error);
    });

/** What the admitted video behind `identity` holds. Rejects with a {@link RemuxError}. */
export const probeVideo = (identity: string) => call<VideoProbe>("probe_video", { identity });

/**
 * Open a remux session for the admitted video behind `identity`, starting at the last keyframe at or before `at`
 * seconds, with its main audio stream if `audio` is set. Rejects with a {@link RemuxError}.
 */
export const remuxOpen = (identity: string, at: number, audio: boolean) =>
    call<RemuxOpened>("remux_open", { identity, at, audio });

/**
 * The next segment of a session, as raw bytes: the fragmented MP4 init segment, then one fragment per call, each
 * beginning on a keyframe, then empty once the video has ended. Rejects with a {@link RemuxError}.
 */
export const remuxNext = (session: number) => call<ArrayBuffer>("remux_next", { session });

/** Close a session. Closing one already closed does nothing. */
export const remuxClose = (session: number) => invoke<void>("remux_close", { session });
