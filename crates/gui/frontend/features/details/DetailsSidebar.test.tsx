import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaType } from "@/ipc/formats";
import { openMedia, revealMedia } from "@/ipc/open";
import type { MediaInfo } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import type { VideoProbe } from "@/ipc/video";
import type { Inclusion } from "@/lib/gallery";
import { DetailsSidebar } from "./DetailsSidebar";
import { InclusionButton, InclusionChips } from "./GalleryDetailsDialog";
import type { FileDetails } from "./rows";

vi.mock("@/ipc/open", () => ({ openMedia: vi.fn(), revealMedia: vi.fn() }));

const mockedOpen = openMedia as Mock;
const mockedReveal = revealMedia as Mock;

const mediaFile = (type: MediaType): MediaFile => ({
    path: type === "video" ? "/Users/me/Movies/VID_0714.mov" : "/Users/me/Pictures/Holiday 2025/DSC_0193.HEIC",
    name: type === "video" ? "VID_0714.mov" : "DSC_0193.HEIC",
    type,
    size: 1,
    identity: type === "video" ? "00000000000000v1" : "00000000000000i1",
});

type SidebarProps = {
    type: MediaType;
    details: FileDetails;
    inclusion?: Inclusion;
    onToggle?: () => void;
};

/** The sidebar for a file of kind `type` as the gallery shows it, included unless said otherwise. */
const Sidebar = ({ type, details, inclusion = "included", onToggle = () => {} }: SidebarProps) => (
    <DetailsSidebar
        file={mediaFile(type)}
        details={details}
        chips={<InclusionChips type={type} inclusion={inclusion} />}
        action={<InclusionButton inclusion={inclusion} onToggle={onToggle} />}
    />
);

const IMAGE: MediaInfo = {
    path: "/Users/me/Pictures/Holiday 2025/DSC_0193.HEIC",
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_100_000,
    format: "HEIC",
    colorProfile: "Display P3",
    bitDepth: 8,
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
        .getAllByText(/^(Image|Video|Not included|Removed)$/)
        .filter((chip) => !chip.closest("section"))
        .map((chip) => chip.textContent);

describe("DetailsSidebar", () => {
    beforeEach(() => {
        mockedOpen.mockReset().mockResolvedValue(undefined);
        mockedReveal.mockReset().mockResolvedValue(undefined);
    });

    it("lists an image's File and Image sections in order", () => {
        const details: FileDetails = { status: "ready", info: IMAGE, path: "~/Pictures/Holiday 2025/DSC_0193.HEIC" };
        render(<Sidebar type="image" details={details} />);

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
            "Bit depth: 8-bit",
        ]);
    });

    it("lists a video's File and Video sections in order", () => {
        const details: FileDetails = { status: "ready", info: VIDEO, path: "~/Movies/VID_0714.mov", streams: STREAMS };
        render(<Sidebar type="video" details={details} />);

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

    it("shows the caller's chips and button in place of the gallery's", () => {
        render(
            <DetailsSidebar
                file={mediaFile("image")}
                details={{ status: "loading" }}
                chips={<span>Custom chip</span>}
                action={<button type="button">Custom action</button>}
            />,
        );

        expect(within(sidebar()).getByText("Custom chip")).toBeInTheDocument();
        expect(within(sidebar()).getByRole("button", { name: "Custom action" })).toBeInTheDocument();
        expect(within(sidebar()).queryByRole("button", { name: /comparison/ })).not.toBeInTheDocument();
        expect(within(sidebar()).getByRole("button", { name: "Open in app" })).toBeInTheDocument();
        expect(within(sidebar()).getByRole("button", { name: "Show in folder" })).toBeInTheDocument();
    });

    it("shows the whole path in a tooltip", () => {
        const path = "~/Pictures/A very long folder name that will not fit/DSC_0193.HEIC";
        render(<Sidebar type="image" details={{ status: "ready", info: IMAGE, path }} />);

        expect(within(sidebar()).getByText(path)).toHaveAttribute("title", path);
    });

    it("adds Not included to a video under Images", () => {
        render(<Sidebar type="video" details={{ status: "loading" }} inclusion="left-out" />);

        expect(chips()).toEqual(["Video", "Not included"]);
    });

    it("shows a placeholder for every value while loading", () => {
        render(<Sidebar type="image" details={{ status: "loading" }} />);

        expect(within(sidebar()).getAllByTestId("detail-placeholder")).toHaveLength(9);
    });

    it("reads Unknown for every value when the details can't be read", () => {
        render(<Sidebar type="video" details={{ status: "failed" }} />);

        expect(within(sidebar()).getAllByText("Unknown")).toHaveLength(11);
        expect(within(sidebar()).queryByTestId("detail-placeholder")).not.toBeInTheDocument();
    });

    it("adds Removed to a removed file", () => {
        render(<Sidebar type="image" details={{ status: "loading" }} inclusion="removed" />);

        expect(chips()).toEqual(["Image", "Removed"]);
    });

    it("adds no chip to an included file, even a video", () => {
        render(<Sidebar type="video" details={{ status: "loading" }} />);

        expect(chips()).toEqual(["Video"]);
    });

    it("shows the three actions, enabled", () => {
        render(<Sidebar type="image" details={{ status: "loading" }} />);

        for (const name of ["Open in app", "Show in folder", "Remove from comparison"]) {
            expect(within(sidebar()).getByRole("button", { name })).toBeEnabled();
        }
    });

    it("opens the file and shows it in its folder by its identity", () => {
        render(<Sidebar type="image" details={{ status: "loading" }} />);

        fireEvent.click(within(sidebar()).getByRole("button", { name: "Open in app" }));
        fireEvent.click(within(sidebar()).getByRole("button", { name: "Show in folder" }));

        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith("00000000000000i1");
        expect(mockedReveal).toHaveBeenCalledExactlyOnceWith("00000000000000i1");
        expect(within(sidebar()).queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each([
        ["Open in app", mockedOpen, "Couldn't open this file."],
        ["Show in folder", mockedReveal, "Couldn't show this file in its folder."],
    ])("says so when %s fails, until it is tried again", async (name, mock, message) => {
        mock.mockRejectedValueOnce({ kind: "missing", message: "it no longer exists" });
        render(<Sidebar type="image" details={{ status: "loading" }} />);
        const action = within(sidebar()).getByRole("button", { name });

        fireEvent.click(action);

        expect(await within(sidebar()).findByRole("alert")).toHaveTextContent(message);

        fireEvent.click(action);

        expect(within(sidebar()).queryByRole("alert")).not.toBeInTheDocument();
        await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
        expect(within(sidebar()).queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each([
        ["included", "Remove from comparison", "lucide-circle-minus"],
        ["removed", "Add back to comparison", "lucide-circle-plus"],
        ["left-out", "Add to comparison", "lucide-circle-plus"],
    ] as const)("reads its label and icon for a file %s, and toggles on click", (inclusion, name, icon) => {
        const onToggle = vi.fn();
        render(<Sidebar type="image" details={{ status: "loading" }} inclusion={inclusion} onToggle={onToggle} />);
        const button = within(sidebar()).getByRole("button", { name });

        expect(button.querySelector(`svg.${icon}`)).toBeInTheDocument();

        fireEvent.click(button);
        expect(onToggle).toHaveBeenCalledOnce();
    });
});
