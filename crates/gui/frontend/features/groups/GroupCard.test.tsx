import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { GroupCard, type GroupView } from "./GroupCard";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const image = (name: string, overrides: Partial<GroupFile> = {}): GroupFile => ({
    path: `/p/${name}`,
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_800_000,
    ...overrides,
});

const video = (name: string): GroupFile => ({
    path: `/v/${name}`,
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42.6,
});

/** The scanned files of `files`, by path. */
const mediaOf = (files: readonly GroupFile[]) =>
    new Map<string, MediaFile>(
        files.map((file) => [
            file.path,
            { path: file.path, name: file.path, type: file.type, size: file.size, identity: `id-${file.path}` },
        ]),
    );

const renderCard = (group: GroupView, number = 1) =>
    render(<GroupCard number={number} group={group} media={mediaOf(group.files)} />);

/** The tile of the file at `path`. */
const tile = (path: string) => {
    const found = document.querySelector(`[data-path="${path}"]`);
    if (!(found instanceof HTMLElement)) throw new Error(`no tile for ${path}`);
    return found;
};

describe("GroupCard", () => {
    it("names an image group and reads each file's details", () => {
        const files = [
            image("IMG_2041.jpg"),
            image("IMG_2041 (1).jpg"),
            image("IMG_2041-edit.jpg", { width: 2048, height: 1536, size: 1_100_000 }),
        ];
        renderCard({ files, best: 0, scores: [1, 1, 0.968] });

        const card = screen.getByRole("region", { name: "Group 1" });
        expect(card).toHaveTextContent("Group 1");
        expect(card).toHaveTextContent("3 images");
        expect(tile("/p/IMG_2041.jpg")).toHaveTextContent("4032×3024 · 4.8 MB");
        expect(within(tile("/p/IMG_2041.jpg")).getByText("IMG_2041.jpg")).toHaveAttribute("title", "/p/IMG_2041.jpg");
        expect(tile("/p/IMG_2041.jpg").querySelector("img")).toHaveAttribute(
            "src",
            "thumb://localhost/id-/p/IMG_2041.jpg?size=512",
        );
    });

    it("names a video group and shows each video's duration", () => {
        const files = [video("VID_0714.mov"), video("VID_0714_small.mp4")];
        renderCard({ files, best: 0, scores: [1, 0.96] });

        expect(screen.getByRole("region", { name: "Group 1" })).toHaveTextContent("2 videos");
        expect(within(tile("/v/VID_0714.mov")).getByText("0:42")).toBeInTheDocument();
        expect(within(tile("/v/VID_0714_small.mp4")).getByText("0:42")).toBeInTheDocument();
    });

    it("shows the Keep badge and best on the best file, and the others' scores against it", () => {
        const files = [image("IMG_2041.jpg"), image("IMG_2041 (1).jpg"), image("IMG_2041-edit.jpg")];
        renderCard({ files, best: 0, scores: [1, 1, 0.968] });

        const best = tile("/p/IMG_2041.jpg");
        expect(within(best).getByText("Keep")).toBeInTheDocument();
        expect(within(best).getByText("best")).toHaveClass("text-primary");
        expect(best.querySelector(".ring-primary")).not.toBeNull();
        expect(within(tile("/p/IMG_2041 (1).jpg")).getByText("100%")).toBeInTheDocument();
        const edit = tile("/p/IMG_2041-edit.jpg");
        expect(within(edit).getByText("97%")).toBeInTheDocument();
        expect(within(edit).queryByText("Keep")).not.toBeInTheDocument();
        expect(edit.querySelector(".ring-primary")).toBeNull();
    });

    it("shows the measured score against the best, even below the threshold", () => {
        // At 90%, A matches B at 0.92 and B matches C at 0.91, so all three are grouped, though A and C score 0.84.
        const files = [image("A.jpg"), image("B.jpg"), image("C.jpg")];
        renderCard({ files, best: 0, scores: [1, 0.92, 0.84] });

        expect(within(tile("/p/C.jpg")).getByText("84%")).toBeInTheDocument();
    });

    it("keeps a group of 6 files small, with 160 × 120 px thumbnails", () => {
        const files = Array.from({ length: 6 }, (_, i) => image(`IMG_${i}.jpg`));
        renderCard({ files, best: 0, scores: files.map(() => 1) });

        const card = screen.getByRole("region", { name: "Group 1" });
        expect(card).not.toHaveClass("w-full");
        expect(card.querySelector(".grid-cols-8")).toBeNull();
        expect(tile("/p/IMG_0.jpg").firstElementChild).toHaveClass("h-[120px]", "w-40");
    });

    it("spans the full width in 8 columns of 4:3 tiles from 7 files", () => {
        const files = Array.from({ length: 7 }, (_, i) => image(`IMG_${i}.jpg`));
        renderCard({ files, best: 0, scores: files.map(() => 1) });

        const card = screen.getByRole("region", { name: "Group 1" });
        expect(card).toHaveClass("w-full");
        expect(card.querySelector(".grid-cols-8")).not.toBeNull();
        expect(tile("/p/IMG_0.jpg").firstElementChild).toHaveClass("aspect-4/3", "w-full");
    });

    it("falls back to the icon of the file's kind without a scanned file", () => {
        const files = [image("a.jpg"), image("b.jpg")];
        render(<GroupCard number={2} group={{ files, best: 0, scores: [1, 0.9] }} media={new Map()} />);

        expect(tile("/p/a.jpg").querySelector("img")).toBeNull();
        expect(tile("/p/a.jpg").querySelector("svg.lucide-image")).not.toBeNull();
    });
});
