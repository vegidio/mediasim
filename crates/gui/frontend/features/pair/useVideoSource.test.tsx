import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo, remuxNext, remuxOpen, type VideoProbe } from "@/ipc/video";
import { mediaSources } from "@/test/mediaSource";
import { VideoPlayer } from "./VideoPlayer";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    probeVideo: vi.fn(),
    remuxOpen: vi.fn(),
    remuxNext: vi.fn(),
    remuxClose: vi.fn(async () => {}),
}));

const mockedProbe = probeVideo as Mock;
const mockedOpen = remuxOpen as Mock;
const mockedNext = remuxNext as Mock;

const FILE: MediaFile = {
    path: "/Movies/VID_0714.mkv",
    name: "VID_0714.mkv",
    type: "video",
    size: 312_000_000,
    identity: "fedcba9876543210",
};

const H264 = { codec: "h264", codecString: "avc1.640028" };
const AAC = { codec: "aac", codecString: "mp4a.40.2" };

const probe = (format: string, audio?: VideoProbe["audio"]): VideoProbe => ({
    format,
    duration: 42,
    video: H264,
    ...(audio && { audio }),
});

const MP4 = probe("mov,mp4,m4a,3gp,3g2,mj2", AAC);
const MKV = probe("matroska,webm", AAC);

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
        await waitFor(() => expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, true));
        expect(mediaSources[0]?.sourceBuffers[0]?.mime).toBe('video/mp4; codecs="avc1.640028,mp4a.40.2"');
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mkv" })).toBeEnabled();
    });

    it("plays without sound, and says so, when the window can't play the audio", async () => {
        mockedProbe.mockResolvedValue(probe("matroska,webm", { codec: "dts" }));
        mount();
        await decided();

        await waitFor(() => expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, false));
        const mute = screen.getByRole("button", { name: "No playable sound in VID_0714.mkv" });
        expect(mute).toBeDisabled();
        expect(screen.queryByRole("button", { name: /^(Un)?mute/ })).not.toBeInTheDocument();
    });

    it("keeps a working mute button for a video with no audio at all", async () => {
        mockedProbe.mockResolvedValue(probe("matroska,webm"));
        mount();
        await decided();

        await waitFor(() => expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, false));
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mkv" })).toBeEnabled();
    });

    it("shows the note for a file it can play neither way", async () => {
        mockedProbe.mockResolvedValue({ format: "asf", duration: 42, video: { codec: "wmv3" } });
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
        await waitFor(() => expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(FILE.identity, 0, true));
        expect(note()).not.toBeInTheDocument();
    });

    it("shows the note when the remux it fell back to fails too", async () => {
        mockedProbe.mockResolvedValue(MP4);
        mockedNext.mockRejectedValue({ kind: "unreadable", message: "bad file" });
        const { video } = mount();
        await decided();

        act(() => {
            fireEvent.error(video);
        });

        await waitFor(() => expect(note()).toBeInTheDocument());
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
