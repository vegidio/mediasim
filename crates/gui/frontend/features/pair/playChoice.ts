import type { StreamProbe, VideoProbe } from "@/ipc/video";

/** What {@link playChoice} asks of the window: the `<video>`'s `canPlayType`, and MSE's `isTypeSupported` if any. */
export type Webview = {
    canPlayType: (type: string) => string;
    /** Absent when the window has no Media Source Extensions. */
    isTypeSupported?: (type: string) => boolean;
};

/** How a video plays remuxed: the type its `SourceBuffer` takes, and whether its sound is carried. */
export type RemuxPlan = {
    /** `video/mp4` with the codecs of the streams the session carries. */
    mime: string;
    /** Whether the session carries the main audio stream. */
    audio: boolean;
    /** Whether the video has sound the window can't play, so the player has none to offer. */
    noSound: boolean;
};

/** How a video plays: from its own bytes (remuxed instead if that fails, when it can be), remuxed, or not at all. */
export type PlayChoice =
    | { kind: "direct"; fallback?: RemuxPlan }
    | { kind: "remux"; plan: RemuxPlan }
    | { kind: "none" };

/**
 * A stand-in for H.264 with no codec string, as in AVI or MPEG-TS: High profile at level 5.1. A window that decodes it
 * decodes almost all 8-bit H.264; the rare stream it can't fails at decode time, which the fallback and the note cover.
 */
export const H264_STAND_IN = "avc1.640033";

/** The MIME types a container may go by, from the demuxer's name for it. */
const CANDIDATES: [demuxer: string, types: string[]][] = [
    ["mp4", ["video/mp4", "video/quicktime"]],
    ["mov", ["video/mp4", "video/quicktime"]],
    ["webm", ["video/webm", "video/x-matroska"]],
    ["matroska", ["video/webm", "video/x-matroska"]],
    ["avi", ["video/x-msvideo"]],
    ["asf", ["video/x-ms-wmv"]],
];

const candidates = (format: string) => {
    const names = format.split(",");
    return [...new Set(CANDIDATES.filter(([demuxer]) => names.includes(demuxer)).flatMap(([, types]) => types))];
};

/** The codec string a stream is asked about by, or `undefined` when there is none to ask with. */
const codecOf = (stream: StreamProbe) => stream.codecString ?? (stream.codec === "h264" ? H264_STAND_IN : undefined);

const withCodecs = (type: string, codecs: (string | undefined)[]) => `${type}; codecs="${codecs.join(",")}"`;

/**
 * How the window plays the video `probe` describes, given what `webview` can decode:
 * - directly, when it can play the container with the codecs of both main streams;
 * - remuxed into fragmented MP4, when its Media Source Extensions can play the video codec, with the sound when they
 *   can also play the audio codec, and flagged `noSound` when they can't;
 * - not at all, otherwise.
 */
export const playChoice = (probe: VideoProbe, webview: Webview): PlayChoice => {
    const video = probe.video && codecOf(probe.video);
    if (!video) return { kind: "none" };
    const audio = probe.audio && codecOf(probe.audio);

    let remux: RemuxPlan | undefined;
    const { isTypeSupported } = webview;
    if (isTypeSupported?.(withCodecs("video/mp4", [video]))) {
        const both = audio !== undefined && withCodecs("video/mp4", [video, audio]);
        if (both && isTypeSupported(both)) {
            remux = { mime: both, audio: true, noSound: false };
        } else {
            // Without an audio stream there is no sound to miss, and the mute button keeps working.
            remux = { mime: withCodecs("video/mp4", [video]), audio: false, noSound: probe.audio !== undefined };
        }
    }

    const playable = !probe.audio || audio !== undefined;
    const codecs = audio === undefined ? [video] : [video, audio];
    const direct = playable && candidates(probe.format).some((type) => webview.canPlayType(withCodecs(type, codecs)));
    if (direct) return remux ? { kind: "direct", fallback: remux } : { kind: "direct" };

    return remux ? { kind: "remux", plan: remux } : { kind: "none" };
};
