import { describe, expect, it } from "vitest";
import type { StreamProbe, VideoProbe } from "@/ipc/video";
import { H264_STAND_IN, type MsePlan, playChoice, type Webview } from "./playChoice";

/** What WKWebView answered in the spike: no Matroska, AVI or WMV directly; no DTS, Opus or AV1 through MSE. */
const MSE_CODECS = new Set(["avc1.640028", H264_STAND_IN, "hvc1.1.6.L120.90", "mp4a.40.2", "ac-3", "mp4v.20"]);
const WEBM_CODECS = new Set(["vp8", "vp9", "vp09.00.40.08", "opus", "vorbis"]);
const DIRECT = new Map([
    ["video/mp4", MSE_CODECS],
    ["video/quicktime", MSE_CODECS],
    ["video/webm", WEBM_CODECS],
]);

const codecsOf = (type: string) => /codecs="([^"]*)"/.exec(type)?.[1]?.split(",") ?? [];

const WEBKIT: Webview = {
    canPlayType: (type) => {
        const known = DIRECT.get(type.split(";")[0] ?? "");
        return known && codecsOf(type).every((codec) => known.has(codec)) ? "probably" : "";
    },
    isTypeSupported: (type) => type.startsWith("video/mp4") && codecsOf(type).every((codec) => MSE_CODECS.has(codec)),
};

const NO_MSE: Webview = { canPlayType: WEBKIT.canPlayType };

const MP4 = "mov,mp4,m4a,3gp,3g2,mj2";
const MKV = "matroska,webm";
const H264: StreamProbe = { codec: "h264", codecString: "avc1.640028", decodable: true };
const AAC: StreamProbe = { codec: "aac", codecString: "mp4a.40.2", decodable: true };
const DTS: StreamProbe = { codec: "dts", decodable: true };
const WMV3: StreamProbe = { codec: "wmv3", decodable: true };
const WMA: StreamProbe = { codec: "wmav2", decodable: true };

const probe = (format: string, video?: StreamProbe, audio?: StreamProbe): VideoProbe => ({
    format,
    duration: 42,
    ...(video && { video }),
    ...(audio && { audio }),
});

const plan = (video: MsePlan["video"], audio: MsePlan["audio"], codecs: string, noSound = false): MsePlan => ({
    video,
    audio,
    mime: `video/mp4; codecs="${codecs}"`,
    noSound,
});

/** The transcode plan with AAC sound encoded. */
const TRANSCODE = plan("encode", "encode", `${H264_STAND_IN},mp4a.40.2`);

describe("playChoice", () => {
    it("plays H.264 and AAC in MP4 directly, with remux and then transcode as the fallbacks", () => {
        expect(playChoice(probe(MP4, H264, AAC), WEBKIT)).toEqual({
            kind: "direct",
            fallbacks: [
                plan("copy", "copy", "avc1.640028,mp4a.40.2"),
                plan("encode", "copy", `${H264_STAND_IN},mp4a.40.2`),
            ],
        });
    });

    it("remuxes H.264 and AAC in Matroska with the sound copied", () => {
        expect(playChoice(probe(MKV, H264, AAC), WEBKIT)).toEqual({
            kind: "mse",
            plan: plan("copy", "copy", "avc1.640028,mp4a.40.2"),
            fallbacks: [plan("encode", "copy", `${H264_STAND_IN},mp4a.40.2`)],
        });
    });

    it("remuxes H.264 and DTS in Matroska with the sound encoded, and no noSound", () => {
        const choice = playChoice(probe(MKV, H264, DTS), WEBKIT);

        expect(choice).toEqual({
            kind: "mse",
            plan: plan("copy", "encode", "avc1.640028,mp4a.40.2"),
            fallbacks: [TRANSCODE],
        });
    });

    it("encodes Opus it can't play, though Opus has a codec string", () => {
        const opus = { codec: "opus", codecString: "opus", decodable: true };

        expect(playChoice(probe(MKV, H264, opus), WEBKIT)).toMatchObject({
            kind: "mse",
            plan: { video: "copy", audio: "encode", noSound: false },
        });
    });

    it("remuxes without sound, flagged noSound, when the sound can't be decoded", () => {
        const choice = playChoice(probe(MKV, H264, { ...DTS, decodable: false }), WEBKIT);

        expect(choice).toEqual({
            kind: "mse",
            plan: plan("copy", "none", "avc1.640028", true),
            fallbacks: [plan("encode", "none", H264_STAND_IN, true)],
        });
    });

    it("remuxes without sound, flagged noSound, when the window can play neither the sound nor AAC", () => {
        const noAac: Webview = { ...WEBKIT, isTypeSupported: (type) => !type.includes("mp4a") };

        expect(playChoice(probe(MKV, H264, DTS), noAac)).toMatchObject({
            kind: "mse",
            plan: { audio: "none", noSound: true },
        });
    });

    it("transcodes WMV3 and WMA, which have no codec strings, with the sound encoded", () => {
        expect(playChoice(probe("asf", WMV3, WMA), WEBKIT)).toEqual({ kind: "mse", plan: TRANSCODE, fallbacks: [] });
    });

    it("remuxes MPEG-4 Part 2 in AVI where MSE claims it, with transcode as the fallback", () => {
        const mpeg4 = { codec: "mpeg4", codecString: "mp4v.20", decodable: true };

        expect(playChoice(probe("avi", mpeg4, AAC), WEBKIT)).toEqual({
            kind: "mse",
            plan: plan("copy", "copy", "mp4v.20,mp4a.40.2"),
            fallbacks: [plan("encode", "copy", `${H264_STAND_IN},mp4a.40.2`)],
        });
    });

    it("transcodes MPEG-4 Part 2 in AVI where MSE can't play it", () => {
        const mpeg4 = { codec: "mpeg4", codecString: "mp4v.20", decodable: true };
        const noMpeg4: Webview = { ...WEBKIT, isTypeSupported: (type) => !type.includes("mp4v") };

        expect(playChoice(probe("avi", mpeg4, AAC), noMpeg4)).toEqual({
            kind: "mse",
            plan: plan("encode", "copy", `${H264_STAND_IN},mp4a.40.2`),
            fallbacks: [],
        });
    });

    it("transcodes AV1 the window can play neither directly nor through MSE", () => {
        const av1 = { codec: "av1", codecString: "av01.0.08M.08", decodable: true };
        const noAv1: Webview = { ...WEBKIT, canPlayType: () => "" };

        expect(playChoice(probe(MP4, av1, AAC), noAv1)).toEqual({
            kind: "mse",
            plan: plan("encode", "copy", `${H264_STAND_IN},mp4a.40.2`),
            fallbacks: [],
        });
    });

    it("gives the note to a video that can't be decoded and has no codec MSE plays", () => {
        expect(playChoice(probe("asf", { ...WMV3, decodable: false }, WMA), WEBKIT)).toEqual({ kind: "none" });
    });

    it("asks about Annex B H.264 in AVI with the stand-in codec string", () => {
        const asked: string[] = [];
        const webview: Webview = {
            canPlayType: (type) => {
                asked.push(type);
                return "";
            },
            isTypeSupported: (type) => {
                asked.push(type);
                return WEBKIT.isTypeSupported?.(type) ?? false;
            },
        };

        const choice = playChoice(probe("avi", { codec: "h264", decodable: true }, AAC), webview);

        expect(choice).toMatchObject({ kind: "mse", plan: plan("copy", "copy", `${H264_STAND_IN},mp4a.40.2`) });
        expect(asked).toContain(`video/x-msvideo; codecs="${H264_STAND_IN},mp4a.40.2"`);
    });

    it("asks every MIME type the container goes by", () => {
        const asked: string[] = [];
        const canPlayType = (type: string) => {
            asked.push(type);
            return "";
        };

        playChoice(probe(MKV, H264, AAC), { canPlayType });

        expect(asked).toEqual([
            'video/webm; codecs="avc1.640028,mp4a.40.2"',
            'video/x-matroska; codecs="avc1.640028,mp4a.40.2"',
        ]);
    });

    it("gives the note to anything it can't play directly when there is no MediaSource", () => {
        expect(playChoice(probe(MKV, H264, AAC), NO_MSE)).toEqual({ kind: "none" });
        expect(playChoice(probe("asf", WMV3, WMA), NO_MSE)).toEqual({ kind: "none" });
    });

    it("still plays directly what it can when there is no MediaSource, with no fallback", () => {
        expect(playChoice(probe(MP4, H264, AAC), NO_MSE)).toEqual({ kind: "direct", fallbacks: [] });
    });

    it("plays VP9 and Opus in WebM directly, with transcode as the fallback", () => {
        const vp9 = { codec: "vp9", codecString: "vp09.00.40.08", decodable: true };
        const opus = { codec: "opus", codecString: "opus", decodable: true };

        expect(playChoice(probe(MKV, vp9, opus), WEBKIT)).toEqual({
            kind: "direct",
            fallbacks: [plan("encode", "encode", `${H264_STAND_IN},mp4a.40.2`)],
        });
    });

    it("never flags noSound for a video-only file", () => {
        for (const video of [H264, WMV3]) {
            const choice = playChoice(probe(MKV, video), WEBKIT);
            const plans = choice.kind === "mse" ? [choice.plan, ...choice.fallbacks] : [];

            expect(plans.length).toBeGreaterThan(0);
            for (const { audio, noSound } of plans) {
                expect({ audio, noSound }).toEqual({ audio: "none", noSound: false });
            }
        }
    });

    it("gives the note to a file with no video stream", () => {
        expect(playChoice(probe(MP4, undefined, AAC), WEBKIT)).toEqual({ kind: "none" });
    });
});
