import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MediaInfo } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import type { Details } from "@/lib/mediaInfo";
import { DetailsTable } from "./DetailsTable";

const media = (name: string, type: MediaFile["type"] = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

const imageInfo = (info: Partial<MediaInfo> = {}): MediaInfo => ({
    path: "/media/a.jpg",
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_800_000,
    format: "JPEG",
    created: new Date(2025, 6, 14, 20, 41).toISOString(),
    ...info,
});

const videoInfo: MediaInfo = {
    path: "/media/a.mp4",
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42.6,
    frameRate: 30,
};

const ready = (info: MediaInfo): Details => ({ status: "ready", info });
const LOADING: Details = { status: "loading" };

const IMAGES = { a: media("IMG_2041.jpg"), b: media("IMG_2041-edit.jpg") };
const VIDEOS = { a: media("a.mp4", "video"), b: media("b.mp4", "video") };

const columns = () => screen.getAllByRole("columnheader").map((header) => header.textContent);

/** The row headed by `badge`, as its cells' text. */
const row = (badge: string) =>
    within(screen.getByRole("rowheader", { name: badge }).closest("tr") as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);

describe("DetailsTable", () => {
    it.each(["trash", "permanent"] as const)("fades and strikes through a file gone to %s", (kind) => {
        render(
            <DetailsTable
                files={IMAGES}
                details={{ a: ready(imageInfo()), b: ready(imageInfo()) }}
                gone={{ b: kind }}
            />,
        );

        const [rowA, rowB] = ["A", "B"].map((badge) => screen.getByRole("rowheader", { name: badge }).closest("tr"));
        expect(rowB).toHaveClass("line-through", "opacity-40");
        expect(rowA).not.toHaveClass("line-through");
    });

    it("lists an image's details as columns, with a row for A and for B", () => {
        render(<DetailsTable files={IMAGES} details={{ a: ready(imageInfo()), b: ready(imageInfo()) }} />);

        expect(screen.getByRole("table")).toBeInTheDocument();
        expect(columns()).toEqual(["File", "Resolution", "File size", "Format", "Created"]);
        expect(screen.getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["A", "B"]);
        expect(row("A")).toEqual(["4032 × 3024", "4.8 MB", "JPEG", "2025-07-14 20:41"]);
    });

    it("lists a video's details as columns", () => {
        render(<DetailsTable files={VIDEOS} details={{ a: ready(videoInfo), b: LOADING }} />);

        expect(columns()).toEqual(["File", "Duration", "Resolution", "Frame rate", "File size"]);
        expect(row("A")).toEqual(["0:42", "1920 × 1080", "30 fps", "312.0 MB"]);
    });

    it("badges only the values that stand out, as the panes do", () => {
        const a = imageInfo();
        const b = imageInfo({ width: 2048, height: 1536, size: 1_100_000 });
        render(<DetailsTable files={IMAGES} details={{ a: ready(a), b: ready(b) }} />);

        expect(row("A")).toEqual(["4032 × 3024Higher", "4.8 MBBigger", "JPEG", "2025-07-14 20:41"]);
        expect(row("B")).toEqual(["2048 × 1536", "1.1 MB", "JPEG", "2025-07-14 20:41"]);
    });

    it("shows placeholders in B's row while B's details load", () => {
        render(<DetailsTable files={IMAGES} details={{ a: ready(imageInfo()), b: LOADING }} />);

        const rowB = screen.getByRole("rowheader", { name: "B" }).closest("tr") as HTMLElement;
        const rowA = screen.getByRole("rowheader", { name: "A" }).closest("tr") as HTMLElement;
        expect(within(rowB).getAllByTestId("detail-placeholder")).toHaveLength(4);
        expect(within(rowA).queryAllByTestId("detail-placeholder")).toHaveLength(0);
        expect(row("A")[0]).toBe("4032 × 3024");
    });

    it("shows Unknown after a failed probe", () => {
        render(<DetailsTable files={IMAGES} details={{ a: ready(imageInfo()), b: { status: "failed" } }} />);

        expect(row("B")).toEqual(["Unknown", "Unknown", "Unknown", "Unknown"]);
    });
});
