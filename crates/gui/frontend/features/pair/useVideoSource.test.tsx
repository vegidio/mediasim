import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo, type StreamProbe, type VideoProbe, videoNext, videoOpen } from "@/ipc/video";
import { mediaSources } from "@/test/mediaSource";
import { VideoPlayer } from "./VideoPlayer";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    probeVideo: vi.fn(),
    videoOpen: vi.fn(),
    videoNext: vi.fn(),
    videoClose: vi.fn(async () => {}),
}));

const mockedProbe = probeVideo as Mock;
const mockedOpen = videoOpen as Mock;
const mockedNext = videoNext as Mock;

const FILE: MediaFile = {
    path: "/Movies/VID_0714.mkv",
    name: "VID_0714.mkv",
    type: "video",
    size: 312_000_000,
    identity: "fedcba9876543210",
};

const H264: StreamProbe = { codec: "h264", codecString: "avc1.640028", decodable: true };
const AAC: StreamProbe = { codec: "aac", codecString: "mp4a.40.2", decodable: true };
const DTS: StreamProbe = { codec: "dts", decodable: true };

const probe = (format: string, audio?: StreamProbe, video: StreamProbe = H264): VideoProbe => ({
    format,
    duration: 42,
    video,
    ...(audio && { audio }),
});

const MP4 = probe("mov,mp4,m4a,3gp,3g2,mj2", AAC);
const MKV = probe("matroska,webm", AAC);
const WMV = probe("asf", { codec: "wmav2", decodable: true }, { codec: "wmv3", decodable: true });

const REMUX = { video: "copy", audio: "copy" };
const TRANSCODE = { video: "encode", audio: "copy" };

/** The modes of each session opened so far. */
const opened = () => mockedOpen.mock.calls.map(([, , modes]) => modes);

/** Fails the element as a decoder failing before the first frame would, and lets the hook react. */
const failBeforeFirstFrame = async (video: HTMLVideoElement) => {
    act(() => {
        fireEvent.error(video);
    });
    await act(async () => {});
};

const mount = (strict = false) => {
    const player = <VideoPlayer file={FILE} />;
    const view = render(strict ? <StrictMode>{player}</StrictMode> : player);
    return { ...view, video: view.container.querySelector("video") as HTMLVideoElement };
};

const play = () => screen.getByRole("button", { name: "Play VID_0714.mkv" });
const note = () => screen.queryByText("Can't play this format yet");

/** Lets the probe answer and the choice take effect. */
const decided = () => waitFor(() => expect(play()).toBeEnabled());

beforeEach(() => {
    mockedProbe.mockReset();
    mockedOpen.mockReset().mockResolvedValue({ session: 1, start: 0 });
    mockedNext.mockReset().mockResolvedValue(new ArrayBuffer(0));
});

describe("useVideoSource", () => {
    it("probes the file, and keeps play unavailable until it is decided how to play it", async () => {
        let answer: (probe: VideoProbe) => void = () => {};
        mockedProbe.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        const { video } = mount();

        expect(mockedProbe).toHaveBeenCalledExactlyOnceWith(FILE.identity);
        expect(play()).toBeDisabled();
        expect(video).not.toHaveAttribute("src");

        await act(async () => answer(MP4));

        expect(play()).toBeEnabled();
    });

    it("plays a file the window can open from its own bytes", async () => {
        mockedProbe.mockResolvedValue(MP4);
        const { video } = mount();
        await decided();

        expect(video).toHaveAttribute("src", "video://localhost/fedcba9876543210");
        expect(mockedOpen).not.toHaveBeenCalled();
    });

    it("plays a file the window can't open remuxed, with its sound", async () => {
        mockedProbe.mockResolvedValue(MKV);
        const { video } = mount();
        await decided();

        expect(video.getAttribute("src")).toMatch(/^blob:/);
        await waitFor(() => expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, REMUX));
        expect(mediaSources[0]?.sourceBuffers[0]?.mime).toBe('video/mp4; codecs="avc1.640028,mp4a.40.2"');
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mkv" })).toBeEnabled();
    });

    it("plays sound the window can't play encoded, with a working mute button", async () => {
        mockedProbe.mockResolvedValue(probe("matroska,webm", DTS));
        mount();
        await decided();

        await waitFor(() => {
            expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, { video: "copy", audio: "encode" });
        });
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mkv" })).toBeEnabled();
    });

    it("plays without sound, and says so, when the sound can be neither copied nor encoded", async () => {
        mockedProbe.mockResolvedValue(probe("matroska,webm", { ...DTS, decodable: false }));
        mount();
        await decided();

        await waitFor(() => {
            expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, { video: "copy", audio: "none" });
        });
        const mute = screen.getByRole("button", { name: "No playable sound in VID_0714.mkv" });
        expect(mute).toBeDisabled();
        expect(screen.queryByRole("button", { name: /^(Un)?mute/ })).not.toBeInTheDocument();
    });

    it("keeps a working mute button for a video with no audio at all", async () => {
        mockedProbe.mockResolvedValue(probe("matroska,webm"));
        mount();
        await decided();

        await waitFor(() => {
            expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, { video: "copy", audio: "none" });
        });
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mkv" })).toBeEnabled();
    });

    it("transcodes a video the window can't decode, with its sound encoded", async () => {
        mockedProbe.mockResolvedValue(WMV);
        const { video } = mount();
        await decided();

        expect(video.getAttribute("src")).toMatch(/^blob:/);
        await waitFor(() => {
            expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, { video: "encode", audio: "encode" });
        });
        expect(mediaSources[0]?.sourceBuffers[0]?.mime).toBe('video/mp4; codecs="avc1.640033,mp4a.40.2"');
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mkv" })).toBeEnabled();
    });

    it("shows the note for a video it can neither play nor decode", async () => {
        mockedProbe.mockResolvedValue(probe("asf", undefined, { codec: "wmv3", decodable: false }));
        const { video } = mount();

        await waitFor(() => expect(note()).toBeInTheDocument());
        expect(video).not.toHaveAttribute("src");
        expect(mockedOpen).not.toHaveBeenCalled();
    });

    it("shows the note when the probe is refused", async () => {
        mockedProbe.mockRejectedValue({ kind: "gone" });
        mount();

        await waitFor(() => expect(note()).toBeInTheDocument());
    });

    it("remuxes a file that fails to play directly before its first frame, without ever showing the note", async () => {
        mockedProbe.mockResolvedValue(MP4);
        const { video } = mount();
        await decided();
        const seen = vi.fn();
        video.addEventListener("error", seen);

        act(() => {
            fireEvent.error(video);
        });

        expect(note()).not.toBeInTheDocument();
        expect(seen).not.toHaveBeenCalled();
        expect(video.getAttribute("src")).toMatch(/^blob:/);
        await waitFor(() => expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, REMUX));
        expect(note()).not.toBeInTheDocument();
    });

    it("goes from direct to remux to transcode on two failures before the first frame, with no note", async () => {
        mockedProbe.mockResolvedValue(MP4);
        const { video } = mount();
        await decided();
        const seen = vi.fn();
        video.addEventListener("error", seen);

        await failBeforeFirstFrame(video);
        await waitFor(() => expect(opened()).toEqual([REMUX]));
        await failBeforeFirstFrame(video);
        await waitFor(() => expect(opened()).toEqual([REMUX, TRANSCODE]));

        expect(seen).not.toHaveBeenCalled();
        expect(note()).not.toBeInTheDocument();
        expect(video.getAttribute("src")).toMatch(/^blob:/);
        expect(mediaSources.at(-1)?.sourceBuffers[0]?.mime).toBe('video/mp4; codecs="avc1.640033,mp4a.40.2"');
    });

    it("shows the note once every way it fell back to has failed too", async () => {
        mockedProbe.mockResolvedValue(MP4);
        mockedNext.mockRejectedValue({ kind: "unreadable", message: "bad file" });
        const { video } = mount();
        await decided();

        act(() => {
            fireEvent.error(video);
        });

        await waitFor(() => expect(note()).toBeInTheDocument());
        expect(opened()).toEqual([REMUX, TRANSCODE]);
    });

    it("shows the note when a remuxed video fails after its first frame, without trying another way", async () => {
        mockedProbe.mockResolvedValue(MKV);
        const { video } = mount();
        await decided();
        await waitFor(() => expect(opened()).toEqual([REMUX]));

        act(() => {
            fireEvent(video, new Event("loadeddata"));
            fireEvent.error(video);
        });

        expect(note()).toBeInTheDocument();
        expect(opened()).toEqual([REMUX]);
    });

    it("shows the note when a direct file fails after its first frame, as a removed one does", async () => {
        mockedProbe.mockResolvedValue(MP4);
        const { video } = mount();
        await decided();

        act(() => {
            fireEvent(video, new Event("loadeddata"));
            fireEvent.error(video);
        });

        expect(note()).toBeInTheDocument();
        expect(mockedOpen).not.toHaveBeenCalled();
    });

    it("pauses the element and clears its source on unmount", async () => {
        mockedProbe.mockResolvedValue(MP4);
        const { video, unmount } = mount();
        await decided();
        act(() => {
            video.play();
        });

        unmount();

        expect(video.paused).toBe(true);
        expect(video).not.toHaveAttribute("src");
    });

    it("sets the source again after StrictMode's rehearsal unmount", async () => {
        mockedProbe.mockResolvedValue(MP4);
        const { video } = mount(true);
        await decided();

        expect(video).toHaveAttribute("src", "video://localhost/fedcba9876543210");
    });
});
