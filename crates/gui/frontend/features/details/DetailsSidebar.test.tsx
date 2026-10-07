import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MediaInfo } from "@/ipc/pair";
import type { VideoProbe } from "@/ipc/video";
import { DetailsSidebar } from "./DetailsSidebar";
import type { FileDetails } from "./rows";

const IMAGE: MediaInfo = {
    path: "/Users/me/Pictures/Holiday 2025/DSC_0193.HEIC",
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_100_000,
    format: "HEIC",
    colorProfile: "Display P3",
};

const VIDEO: MediaInfo = {
    path: "/Users/me/Movies/VID_0714.mov",
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42,
    frameRate: 30000 / 1001,
};

const STREAMS: VideoProbe = {
    format: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: 42,
    video: { codec: "hevc", decodable: true },
    audio: { codec: "aac", decodable: true, sampleRate: 48000 },
};

const sidebar = () => screen.getByRole("complementary", { name: "File details" });

/** Each section's title, then its rows as `key: value`. */
const lines = () =>
    within(sidebar())
        .getAllByRole("region")
        .flatMap((section) => [
            within(section).getByRole("heading").textContent,
            ...within(section)
                .getAllByRole("term")
                .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`),
        ]);

/** The chips above the sections, leaving out the sections' own "Image" or "Video" titles. */
const chips = () =>
    within(sidebar())
        .getAllByText(/^(Image|Video|Not included)$/)
        .filter((chip) => !chip.closest("section"))
        .map((chip) => chip.textContent);

describe("DetailsSidebar", () => {
    it("lists an image's File and Image sections in order", () => {
        const details: FileDetails = { status: "ready", info: IMAGE, path: "~/Pictures/Holiday 2025/DSC_0193.HEIC" };
        render(<DetailsSidebar type="image" details={details} included />);

        expect(chips()).toEqual(["Image"]);
        expect(lines()).toEqual([
            "File",
            "Path: ~/Pictures/Holiday 2025/DSC_0193.HEIC",
            "Size: 4.1 MB",
            "Format: HEIC",
            "Created: Unknown",
            "Modified: Unknown",
            "Image",
            "Dimensions: 4032 × 3024",
            "Megapixels: 12.2 MP",
            "Colour profile: Display P3",
        ]);
    });

    it("lists a video's File and Video sections in order", () => {
        const details: FileDetails = { status: "ready", info: VIDEO, path: "~/Movies/VID_0714.mov", streams: STREAMS };
        render(<DetailsSidebar type="video" details={details} included />);

        expect(lines()).toEqual([
            "File",
            "Path: ~/Movies/VID_0714.mov",
            "Size: 312.0 MB",
            "Format: QuickTime (.mov)",
            "Created: Unknown",
            "Modified: Unknown",
            "Video",
            "Duration: 0:42",
            "Resolution: 1920 × 1080",
            "Frame rate: 29.97 fps",
            "Codec: HEVC (H.265)",
            "Bitrate: 59.4 Mb/s",
            "Audio: AAC · 48 kHz",
        ]);
    });

    it("shows the whole path in a tooltip", () => {
        const path = "~/Pictures/A very long folder name that will not fit/DSC_0193.HEIC";
        render(<DetailsSidebar type="image" details={{ status: "ready", info: IMAGE, path }} included />);

        expect(within(sidebar()).getByText(path)).toHaveAttribute("title", path);
    });

    it("adds Not included to a video under Images", () => {
        render(<DetailsSidebar type="video" details={{ status: "loading" }} included={false} />);

        expect(chips()).toEqual(["Video", "Not included"]);
    });

    it("shows a placeholder for every value while loading", () => {
        render(<DetailsSidebar type="image" details={{ status: "loading" }} included />);

        expect(within(sidebar()).getAllByTestId("detail-placeholder")).toHaveLength(8);
    });

    it("reads Unknown for every value when the details can't be read", () => {
        render(<DetailsSidebar type="video" details={{ status: "failed" }} included />);

        expect(within(sidebar()).getAllByText("Unknown")).toHaveLength(11);
        expect(within(sidebar()).queryByTestId("detail-placeholder")).not.toBeInTheDocument();
    });

    it("shows the three actions, disabled", () => {
        render(<DetailsSidebar type="image" details={{ status: "loading" }} included />);

        for (const name of ["Open in app", "Show in folder", "Remove from comparison"]) {
            expect(within(sidebar()).getByRole("button", { name })).toBeDisabled();
        }
    });
});
