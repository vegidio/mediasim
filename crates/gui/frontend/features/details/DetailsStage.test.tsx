import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import { DetailsStage } from "./DetailsStage";
import { Filmstrip } from "./Filmstrip";

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

const IMAGE: MediaFile = {
    path: "/p/DSC_0193.HEIC",
    name: "DSC_0193.HEIC",
    type: "image",
    size: 4_100_000,
    identity: "0123456789abcdef",
};

const VIDEO: MediaFile = {
    path: "/p/VID_0714.mov",
    name: "VID_0714.mov",
    type: "video",
    size: 312_000_000,
    identity: "fedcba9876543210",
};

/** 48 files, `IMG_01.jpg` to `IMG_48.jpg`, with the 20th a video. */
const FILES: MediaFile[] = Array.from({ length: 48 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    const video = i === 19;
    return {
        path: `/p/${n}`,
        name: video ? `VID_${n}.mov` : `IMG_${n}.jpg`,
        type: video ? "video" : "image",
        size: 1,
        identity: `id${n}`.padEnd(16, "0"),
    };
});

beforeEach(() => {
    mockedProbe.mockReset().mockResolvedValue({
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: 42,
        video: { codec: "h264", codecString: "avc1.640028", decodable: true },
    });
});

describe("DetailsStage", () => {
    it("shows an image's picture at the full size, with no player bar", () => {
        const { container } = render(<DetailsStage file={IMAGE} />);

        expect(container.querySelector("img")).toHaveAttribute("src", "thumb://localhost/0123456789abcdef?size=2048");
        expect(screen.queryByRole("group", { name: /^Player for/ })).not.toBeInTheDocument();
    });

    it.each([
        ["an image", IMAGE, "lucide-image"],
        ["a video", VIDEO, "lucide-video"],
    ])("shows the kind icon when the picture of %s can't be produced", (_kind, file, icon) => {
        const { container } = render(<DetailsStage file={file} />);
        const img = container.querySelector("img") as HTMLImageElement;
        fireEvent.load(img);
        expect(container.querySelector(`svg.${icon}`)).not.toBeInTheDocument();

        fireEvent.error(img);

        expect(img).toHaveClass("invisible");
        expect(container.querySelector(`svg.${icon}`)).toBeInTheDocument();
    });

    it("shows a video's still, and plays it at once with its sound on", async () => {
        const { container } = render(<DetailsStage file={VIDEO} />);
        const video = container.querySelector("video") as HTMLVideoElement;

        expect(container.querySelector("img")).toHaveAttribute("src", "thumb://localhost/fedcba9876543210?size=2048");
        expect(await screen.findByRole("button", { name: "Play VID_0714.mov" })).toBeInTheDocument();
        // jsdom never plays media; a webview starts it once enough of it has loaded.
        expect(video.autoplay).toBe(true);
        expect(video.muted).toBe(false);
        expect(screen.getByRole("button", { name: "Mute VID_0714.mov" })).toBeInTheDocument();
    });

    it("unmounts the player when stepping away from a video", async () => {
        const { container, rerender } = render(<DetailsStage file={VIDEO} />);
        await screen.findByRole("button", { name: "Play VID_0714.mov" });

        rerender(<DetailsStage file={IMAGE} />);

        expect(container.querySelector("video")).not.toBeInTheDocument();
        expect(screen.queryByRole("group", { name: /^Player for/ })).not.toBeInTheDocument();
    });

    it("tells the picture's shape once it loads", () => {
        const onRatio = vi.fn();
        const { container } = render(<DetailsStage file={IMAGE} onRatio={onRatio} />);
        const img = container.querySelector("img") as HTMLImageElement;
        Object.defineProperties(img, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });

        fireEvent.load(img);

        expect(onRatio).toHaveBeenCalledExactlyOnceWith(4 / 3);
    });
});

describe("Filmstrip", () => {
    const strip = () => screen.getAllByRole("button", { name: /^Show / });
    const names = () => strip().map((thumb) => thumb.getAttribute("aria-label")?.replace("Show ", ""));

    it("shows the 17th to the 23rd around the 20th, ringing the 20th", () => {
        render(<Filmstrip files={FILES} index={19} onShow={() => {}} />);

        expect(names()).toEqual([
            "IMG_17.jpg",
            "IMG_18.jpg",
            "IMG_19.jpg",
            "VID_20.mov",
            "IMG_21.jpg",
            "IMG_22.jpg",
            "IMG_23.jpg",
        ]);
        const current = screen.getByRole("button", { name: "Show VID_20.mov" });
        expect(current).toHaveAttribute("aria-current", "true");
        expect(current).not.toHaveClass("opacity-70");
        expect(screen.getByRole("button", { name: "Show IMG_19.jpg" })).toHaveClass("opacity-70");
    });

    it("shows the first 7 around the 2nd", () => {
        render(<Filmstrip files={FILES} index={1} onShow={() => {}} />);

        expect(names()).toEqual(FILES.slice(0, 7).map((file) => file.name));
        expect(screen.getByRole("button", { name: "Show IMG_02.jpg" })).toHaveAttribute("aria-current", "true");
    });

    it("asks for small thumbnails, with a play mark on videos", () => {
        const { container } = render(<Filmstrip files={FILES} index={19} onShow={() => {}} />);

        expect(container.querySelector("img")).toHaveAttribute("src", "thumb://localhost/id17000000000000?size=256");
        const video = screen.getByRole("button", { name: "Show VID_20.mov" });
        expect(video.querySelector("svg.lucide-play")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Show IMG_21.jpg" }).querySelector("svg.lucide-play")).toBeNull();
    });

    it("shows a file when its thumbnail is activated", () => {
        const onShow = vi.fn();
        render(<Filmstrip files={FILES} index={19} onShow={onShow} />);

        fireEvent.click(screen.getByRole("button", { name: "Show IMG_22.jpg" }));

        expect(onShow).toHaveBeenCalledExactlyOnceWith(FILES[21]);
    });
});
