import type { AudioMode, StreamProbe, VideoMode, VideoProbe } from "@/ipc/video";

/** What {@link playChoice} asks of the window: the `<video>`'s `canPlayType`, and MSE's `isTypeSupported` if any. */
export type Webview = {
    canPlayType: (type: string) => string;
    /** Absent when the window has no Media Source Extensions. */
    isTypeSupported?: (type: string) => boolean;
};

/** How a video plays through Media Source Extensions: how its session carries each stream, and its buffer's type. */
export type MsePlan = {
    /** `copy` remuxes the video; `encode` transcodes it to H.264. */
    video: VideoMode;
    audio: AudioMode;
    /** `video/mp4` with the codecs of the streams the session carries. */
    mime: string;
    /** Whether the video has sound that can be neither copied nor encoded for the window, so the player has none. */
    noSound: boolean;
};

/**
 * How a video plays: from its own bytes, or through Media Source Extensions, each with the MSE plans to fall back to,
 * in order, if it fails before its first frame; or not at all.
 */
export type PlayChoice =
    | { kind: "direct"; fallbacks: MsePlan[] }
    | { kind: "mse"; plan: MsePlan; fallbacks: MsePlan[] }
    | { kind: "none" };

/**
 * A stand-in for H.264 with no codec string, as in AVI or MPEG-TS: High profile at level 5.1. A window that decodes it
 * decodes almost all 8-bit H.264; the rare stream it can't fails at decode time, which the fallback and the note cover.
 * It is also what a transcoded video declares: the encoder's level is never above 5.1 at 1080p.
 */
export const H264_STAND_IN = "avc1.640033";

/** What encoded sound declares: AAC-LC. */
const AAC = "mp4a.40.2";

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

const withCodecs = (type: string, codecs: string[]) => `${type}; codecs="${codecs.join(",")}"`;

/**
 * The MSE plan for a session whose video declares `video`, given the file's `sound`: the sound copied when the window
 * can play its codec beside the video, encoded to AAC when it can't but the application can decode it and the window
 * can play AAC, and left out otherwise, which is flagged `noSound` unless there is no sound to miss.
 */
const planFor = (
    video: VideoMode,
    videoCodec: string,
    isTypeSupported: (type: string) => boolean,
    sound?: StreamProbe,
): MsePlan => {
    const mime = (codecs: string[]) => withCodecs("video/mp4", codecs);
    if (!sound) return { video, audio: "none", mime: mime([videoCodec]), noSound: false };

    const soundCodec = codecOf(sound);
    if (soundCodec && isTypeSupported(mime([videoCodec, soundCodec]))) {
        return { video, audio: "copy", mime: mime([videoCodec, soundCodec]), noSound: false };
    }
    if (sound.decodable && isTypeSupported(mime([videoCodec, AAC]))) {
        return { video, audio: "encode", mime: mime([videoCodec, AAC]), noSound: false };
    }
    return { video, audio: "none", mime: mime([videoCodec]), noSound: true };
};

/**
 * How the window plays the video `probe` describes, given what `webview` can decode. The ways, in order:
 * 1. directly, when it can play the container with the codecs of both main streams;
 * 2. remuxed, the video copied into fragmented MP4, when its Media Source Extensions can play the video codec;
 * 3. transcoded, the video encoded to H.264, when the application can decode it and the window's MSE can play H.264.
 *
 * Each MSE way carries the sound as {@link planFor} decides. The first way that applies is chosen, and the MSE ways
 * after it are its fallbacks. No way at all is `none`, the "Can't play this format yet" note.
 */
export const playChoice = (probe: VideoProbe, webview: Webview): PlayChoice => {
    const { video, audio } = probe;
    if (!video) return { kind: "none" };

    const plans: MsePlan[] = [];
    const { isTypeSupported } = webview;
    if (isTypeSupported) {
        const copied = codecOf(video);
        if (copied && isTypeSupported(withCodecs("video/mp4", [copied]))) {
            plans.push(planFor("copy", copied, isTypeSupported, audio));
        }
        if (video.decodable && isTypeSupported(withCodecs("video/mp4", [H264_STAND_IN]))) {
            plans.push(planFor("encode", H264_STAND_IN, isTypeSupported, audio));
        }
    }

    const videoCodec = codecOf(video);
    const audioCodec = audio && codecOf(audio);
    const playable = !!videoCodec && (!audio || !!audioCodec);
    const codecs = [videoCodec, audioCodec].filter((codec) => codec !== undefined);
    const direct = playable && candidates(probe.format).some((type) => webview.canPlayType(withCodecs(type, codecs)));
    if (direct) return { kind: "direct", fallbacks: plans };

    const [plan, ...fallbacks] = plans;
    return plan ? { kind: "mse", plan, fallbacks } : { kind: "none" };
};
