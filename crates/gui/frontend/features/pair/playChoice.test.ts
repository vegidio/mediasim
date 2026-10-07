import { describe, expect, it } from "vitest";
import type { VideoProbe } from "@/ipc/video";
import { H264_STAND_IN, playChoice, type Webview } from "./playChoice";

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
const H264 = { codec: "h264", codecString: "avc1.640028" };
const AAC = { codec: "aac", codecString: "mp4a.40.2" };
const DTS = { codec: "dts" };

const probe = (format: string, video?: VideoProbe["video"], audio?: VideoProbe["audio"]): VideoProbe => ({
    format,
    duration: 42,
    ...(video && { video }),
    ...(audio && { audio }),
});

describe("playChoice", () => {
    it("plays H.264 and AAC in MP4 directly, with remux as the fallback", () => {
        expect(playChoice(probe(MP4, H264, AAC), WEBKIT)).toEqual({
            kind: "direct",
            fallback: { mime: 'video/mp4; codecs="avc1.640028,mp4a.40.2"', audio: true, noSound: false },
        });
    });

    it("remuxes H.264 and AAC in Matroska with the sound", () => {
        expect(playChoice(probe(MKV, H264, AAC), WEBKIT)).toEqual({
            kind: "remux",
            plan: { mime: 'video/mp4; codecs="avc1.640028,mp4a.40.2"', audio: true, noSound: false },
        });
    });

    it("remuxes H.264 and DTS in Matroska without sound, flagged noSound", () => {
        expect(playChoice(probe(MKV, H264, DTS), WEBKIT)).toEqual({
            kind: "remux",
            plan: { mime: 'video/mp4; codecs="avc1.640028"', audio: false, noSound: true },
        });
    });

    it("remuxes Opus it can't play without sound, though Opus has a codec string", () => {
        const choice = playChoice(probe(MKV, H264, { codec: "opus", codecString: "opus" }), WEBKIT);

        expect(choice).toEqual({ kind: "remux", plan: expect.objectContaining({ audio: false, noSound: true }) });
    });

    it("remuxes a video-only Matroska file without flagging noSound", () => {
        expect(playChoice(probe(MKV, H264), WEBKIT)).toEqual({
            kind: "remux",
            plan: { mime: 'video/mp4; codecs="avc1.640028"', audio: false, noSound: false },
        });
    });

    it("gives the note to WMV3, which has no codec string", () => {
        expect(playChoice(probe("asf", { codec: "wmv3" }, { codec: "wmav2" }), WEBKIT)).toEqual({ kind: "none" });
    });

    it("gives the note to MPEG-4 Part 2 in AVI where MSE can't play it", () => {
        const mpeg4 = { codec: "mpeg4", codecString: "mp4v.20" };
        const noMpeg4: Webview = { ...WEBKIT, isTypeSupported: (type) => !type.includes("mp4v") };

        expect(playChoice(probe("avi", mpeg4, AAC), noMpeg4)).toEqual({ kind: "none" });
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

        const choice = playChoice(probe("avi", { codec: "h264" }, AAC), webview);

        expect(choice).toEqual({
            kind: "remux",
            plan: { mime: `video/mp4; codecs="${H264_STAND_IN},mp4a.40.2"`, audio: true, noSound: false },
        });
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

    it("gives the note to a file it can't play directly when there is no MediaSource", () => {
        expect(playChoice(probe(MKV, H264, AAC), NO_MSE)).toEqual({ kind: "none" });
    });

    it("still plays directly what it can when there is no MediaSource, with no fallback", () => {
        expect(playChoice(probe(MP4, H264, AAC), NO_MSE)).toEqual({ kind: "direct" });
    });

    it("plays VP9 and Opus in WebM directly", () => {
        const vp9 = { codec: "vp9", codecString: "vp09.00.40.08" };

        expect(playChoice(probe(MKV, vp9, { codec: "opus", codecString: "opus" }), WEBKIT)).toEqual({ kind: "direct" });
    });

    it("gives the note to a file with no video stream", () => {
        expect(playChoice(probe(MP4, undefined, AAC), WEBKIT)).toEqual({ kind: "none" });
    });
});
