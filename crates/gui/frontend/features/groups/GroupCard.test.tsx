import { fireEvent, render, screen, within } from "@testing-library/react";
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

const renderCard = (
    group: GroupView,
    number = 1,
    { marks = new Set<string>(), onToggle = () => {}, onKeepBestOnly = () => {} } = {},
) =>
    render(
        <GroupCard
            number={number}
            group={group}
            media={mediaOf(group.files)}
            marks={marks}
            onToggle={onToggle}
            onKeepBestOnly={onKeepBestOnly}
        />,
    );

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
        renderCard({ files, best: 0 });

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
        renderCard({ files, best: 0 });

        expect(screen.getByRole("region", { name: "Group 1" })).toHaveTextContent("2 videos");
        expect(within(tile("/v/VID_0714.mov")).getByText("0:42")).toBeInTheDocument();
        expect(within(tile("/v/VID_0714_small.mp4")).getByText("0:42")).toBeInTheDocument();
    });

    it("shows the Keep badge and best on the best file, and no score on the others", () => {
        const files = [image("IMG_2041.jpg"), image("IMG_2041 (1).jpg"), image("IMG_2041-edit.jpg")];
        renderCard({ files, best: 0 });

        const best = tile("/p/IMG_2041.jpg");
        expect(within(best).getByText("Keep")).toBeInTheDocument();
        expect(within(best).getByText("best")).toHaveClass("text-primary");
        expect(best.querySelector(".ring-primary")).not.toBeNull();
        const edit = tile("/p/IMG_2041-edit.jpg");
        expect(edit).not.toHaveTextContent(/%|best/);
        expect(tile("/p/IMG_2041 (1).jpg")).not.toHaveTextContent(/%|best/);
        expect(within(edit).queryByText("Keep")).not.toBeInTheDocument();
        expect(edit.querySelector(".ring-primary")).toBeNull();
    });

    it("keeps a group of 6 files small, with 160 × 120 px thumbnails", () => {
        const files = Array.from({ length: 6 }, (_, i) => image(`IMG_${i}.jpg`));
        renderCard({ files, best: 0 });

        const card = screen.getByRole("region", { name: "Group 1" });
        expect(card).not.toHaveClass("w-full");
        expect(card.querySelector(".grid-cols-8")).toBeNull();
        expect(tile("/p/IMG_0.jpg").firstElementChild).toHaveClass("h-[120px]", "w-40");
    });

    it("spans the full width in 8 columns of 4:3 tiles from 7 files", () => {
        const files = Array.from({ length: 7 }, (_, i) => image(`IMG_${i}.jpg`));
        renderCard({ files, best: 0 });

        const card = screen.getByRole("region", { name: "Group 1" });
        expect(card).toHaveClass("w-full");
        expect(card.querySelector(".grid-cols-8")).not.toBeNull();
        expect(tile("/p/IMG_0.jpg").firstElementChild).toHaveClass("aspect-4/3", "w-full");
    });

    it("falls back to the icon of the file's kind without a scanned file", () => {
        const files = [image("a.jpg"), image("b.jpg")];
        render(
            <GroupCard
                number={2}
                group={{ files, best: 0 }}
                media={new Map()}
                marks={new Set()}
                onToggle={() => {}}
                onKeepBestOnly={() => {}}
            />,
        );

        expect(tile("/p/a.jpg").querySelector("img")).toBeNull();
        expect(tile("/p/a.jpg").querySelector("svg.lucide-image")).not.toBeNull();
    });

    describe("marking", () => {
        const files = [image("IMG_2041.jpg"), image("IMG_2041 (1).jpg"), image("IMG_2041-edit.jpg")];

        it("ends the heading row with Keep best only, which calls onKeepBestOnly", () => {
            const onKeepBestOnly = vi.fn();
            renderCard({ files, best: 0 }, 1, { onKeepBestOnly });

            const button = screen.getByRole("button", { name: "Keep best only" });
            expect(button.parentElement).toHaveTextContent(/^Group 13 imagesKeep best only$/);
            fireEvent.click(button);

            expect(onKeepBestOnly).toHaveBeenCalledOnce();
        });

        it("calls onToggle with a tile's path when its box is checked", () => {
            const onToggle = vi.fn();
            renderCard({ files, best: 0 }, 1, { onToggle });

            fireEvent.click(screen.getByRole("checkbox", { name: "Mark IMG_2041-edit.jpg for deletion" }));

            expect(onToggle).toHaveBeenCalledExactlyOnceWith("/p/IMG_2041-edit.jpg");
        });

        it.each([
            ["small", 3],
            ["large", 7],
        ])("shows the tiles in marks as marked, in a %s card", (_, size) => {
            const group = Array.from({ length: size }, (_, i) => image(`IMG_${i}.jpg`));
            renderCard({ files: group, best: 0 }, 1, {
                marks: new Set(["/p/IMG_0.jpg", "/p/IMG_2.jpg"]),
            });

            const checked = screen
                .getAllByRole("checkbox")
                .filter((box) => box.getAttribute("aria-checked") === "true");
            expect(checked.map((box) => box.getAttribute("aria-label"))).toEqual([
                "Mark IMG_0.jpg for deletion",
                "Mark IMG_2.jpg for deletion",
            ]);
            expect(within(tile("/p/IMG_0.jpg")).getByText("Delete")).toBeInTheDocument();
            expect(within(tile("/p/IMG_1.jpg")).queryByText("Delete")).not.toBeInTheDocument();
        });
    });
});
