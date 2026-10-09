import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createLru } from "@/lib/lru";
import { invokeOr, isRecord } from "./wire";

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
    /** Whether the application can decode the stream, and so encode it for the window. */
    decodable: boolean;
    /** In hertz, for an audio stream. */
    sampleRate?: number;
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

/** How a session carries the main video stream: copied unchanged, or encoded to H.264. */
export type VideoMode = "copy" | "encode";

/** How a session carries the main audio stream: left out, copied unchanged, or encoded to AAC. */
export type AudioMode = "none" | "copy" | "encode";

/** How a session carries each main stream. */
export type SessionModes = { video: VideoMode; audio: AudioMode };

/** A session just opened. */
export type VideoOpened = {
    session: number;
    /**
     * The time, in seconds, the session starts from: the last keyframe at or before the time asked when the video is
     * copied, the last 2-second boundary when it is encoded.
     */
    start: number;
};

/**
 * Why a probe or a session request was refused, as `VideoError` in `crates/gui/src/video/error.rs` serializes it.
 * `task` is a background task that didn't finish, which says nothing about the file.
 */
export type VideoError =
    | { kind: "notfound" }
    | { kind: "gone" }
    | { kind: "unreadable"; message: string }
    | { kind: "task"; message: string };

/** The {@link VideoError} a rejection carries, or a `task` one for anything else, such as a missing command. */
const toVideoError = (error: unknown): VideoError => {
    if (isRecord(error)) {
        const { kind, message } = error;
        if (kind === "notfound" || kind === "gone") return { kind };
        if ((kind === "unreadable" || kind === "task") && typeof message === "string") return { kind, message };
    }

    return { kind: "task", message: String(error) };
};

const call = invokeOr(toVideoError);

/** How many videos' probes are kept. */
const PROBES_KEPT = 500;

/**
 * Each video's probe, by identity, for the videos probed last. An identity names one file as it was admitted, unchanged,
 * so its probe never goes stale, and a player mounted again, as on a tab switch, doesn't read the header again.
 */
const probes = createLru<string, Promise<VideoProbe>>(PROBES_KEPT);

/**
 * What the admitted video behind `identity` holds, read once per identity. Rejects with a {@link VideoError}; a probe
 * that failed isn't kept, so the next call asks again.
 */
export const probeVideo = (identity: string): Promise<VideoProbe> => {
    const known = probes.get(identity);
    if (known) return known;

    const probe = call<VideoProbe>("probe_video", { identity });
    probes.set(identity, probe);
    probe.catch(() => {
        if (probes.get(identity) === probe) probes.delete(identity);
    });
    return probe;
};

/** Forget every probe read so far, so each test starts with none. */
export const forgetVideoProbes = () => probes.clear();

/**
 * Open a session for the admitted video behind `identity`, starting at or before `at` seconds, carrying its main
 * streams as `modes` says. Rejects with a {@link VideoError}.
 */
export const videoOpen = (identity: string, at: number, { video, audio }: SessionModes) =>
    call<VideoOpened>("video_open", { identity, at, video, audio });

/**
 * The next segment of a session, as raw bytes: the fragmented MP4 init segment, then one segment's fragments per call,
 * each beginning on a keyframe, then empty once the video has ended. Rejects with a {@link VideoError}; `notfound`
 * also when the session was closed while this was answered.
 */
export const videoNext = (session: number) => call<ArrayBuffer>("video_next", { session });

/** Close a session, stopping any encode in progress for it. Closing one already closed does nothing. */
export const videoClose = (session: number) => invoke<void>("video_close", { session });
