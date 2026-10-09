import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import { GroupTile } from "./GroupTile";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const IMAGE: GroupFile = { path: "/p/IMG_2041 (1).jpg", type: "image", width: 4032, height: 3024, size: 4_800_000 };
const VIDEO: GroupFile = {
    path: "/v/VID_0714.mov",
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42.6,
};

const renderTile = ({
    file = IMAGE,
    best = false,
    marked = false,
    selected = false,
    tabbable = false,
    onToggle = () => {},
    onSelect = () => {},
    onOpen = () => {},
    onKey = () => {},
} = {}) =>
    render(
        <GroupTile
            file={file}
            best={best}
            large={false}
            marked={marked}
            onToggle={onToggle}
            selected={selected}
            tabbable={tabbable}
            onSelect={onSelect}
            onOpen={onOpen}
            onKey={onKey}
        />,
    );

const checkbox = () => screen.getByRole("checkbox", { name: "Mark IMG_2041 (1).jpg for deletion" });
const thumbnail = () => screen.getByRole("button", { name: "IMG_2041 (1).jpg" });

/** The thumbnail's frame, which draws the rings. */
const frame = () => thumbnail().parentElement as HTMLElement;

describe("GroupTile", () => {
    describe("thumbnail button", () => {
        it("is named after the file, and carries its path", () => {
            renderTile();

            expect(thumbnail()).toHaveAttribute("data-select", IMAGE.path);
        });

        it("is aria-current only while selected", () => {
            const { rerender } = renderTile();
            expect(thumbnail()).not.toHaveAttribute("aria-current");

            rerender(
                <GroupTile
                    file={IMAGE}
                    best={false}
                    large={false}
                    marked={false}
                    onToggle={() => {}}
                    selected
                    tabbable
                    onSelect={() => {}}
                    onOpen={() => {}}
                    onKey={() => {}}
                />,
            );

            expect(thumbnail()).toHaveAttribute("aria-current", "true");
        });

        it("is a tab stop only while tabbable", () => {
            const { unmount } = renderTile({ tabbable: true });
            expect(thumbnail()).toHaveAttribute("tabindex", "0");
            unmount();

            renderTile();
            expect(thumbnail()).toHaveAttribute("tabindex", "-1");
        });

        it("selects and focuses the tile on a click, without opening it", () => {
            const onSelect = vi.fn();
            const onOpen = vi.fn();
            renderTile({ onSelect, onOpen });

            fireEvent.click(thumbnail());

            expect(onSelect).toHaveBeenCalled();
            expect(thumbnail()).toHaveFocus();
            expect(onOpen).not.toHaveBeenCalled();
        });

        it("selects the tile when focused", () => {
            const onSelect = vi.fn();
            renderTile({ onSelect });

            thumbnail().focus();

            expect(onSelect).toHaveBeenCalledOnce();
        });

        it("opens the details on a double click", () => {
            const onOpen = vi.fn();
            renderTile({ onOpen });

            fireEvent.doubleClick(thumbnail());

            expect(onOpen).toHaveBeenCalledOnce();
        });

        it("hands its keys to onKey, with its path", () => {
            const onKey = vi.fn();
            renderTile({ onKey });

            fireEvent.keyDown(thumbnail(), { key: "ArrowRight" });

            expect(onKey).toHaveBeenCalledExactlyOnceWith(IMAGE.path, expect.objectContaining({ key: "ArrowRight" }));
        });

        it("isn't reached by a click on the checkbox, which only toggles the mark", () => {
            const onSelect = vi.fn();
            const onOpen = vi.fn();
            const onToggle = vi.fn();
            renderTile({ onSelect, onOpen, onToggle });

            fireEvent.click(checkbox());
            fireEvent.doubleClick(checkbox());

            expect(onToggle).toHaveBeenCalled();
            expect(onSelect).not.toHaveBeenCalled();
            expect(onOpen).not.toHaveBeenCalled();
            expect(thumbnail()).not.toContainElement(checkbox());
        });

        it("lets clicks on the badges through", () => {
            renderTile({ best: true });

            expect(screen.getByText("Best")).toHaveClass("pointer-events-none");
        });
    });

    describe("rings", () => {
        it("gives an unselected best file no lime ring, only the faint outline", () => {
            const { container } = renderTile({ best: true });

            expect(frame()).not.toHaveClass("ring-primary");
            expect(
                container.querySelector(".shadow-\\[inset_0_0_0_1px_rgba\\(255\\,255\\,255\\,0\\.08\\)\\]"),
            ).not.toBeNull();
        });

        it("gives a selected tile the lime ring, best file or not", () => {
            const { unmount } = renderTile({ best: true, selected: true });
            expect(frame()).toHaveClass("ring-primary");
            unmount();

            renderTile({ selected: true });
            expect(frame()).toHaveClass("ring-primary");
        });

        it("gives a selected marked tile the lime ring with the wash and Delete badge, and no red ring", () => {
            const { container } = renderTile({ marked: true, selected: true });

            expect(frame()).toHaveClass("ring-primary");
            expect(frame()).not.toHaveClass("ring-[#EF4444]");
            expect(container.querySelector(".bg-\\[rgba\\(69\\,10\\,10\\,0\\.62\\)\\]")).not.toBeNull();
            expect(screen.getByText("Delete")).toBeInTheDocument();
        });
    });

    describe("mark checkbox", () => {
        it("is named after the file and unchecked while unmarked", () => {
            renderTile();

            expect(checkbox()).not.toBeChecked();
        });

        it("reads checked while marked", () => {
            renderTile({ marked: true });

            expect(checkbox()).toBeChecked();
        });

        it("calls onToggle when clicked", () => {
            const onToggle = vi.fn();
            renderTile({ onToggle });

            fireEvent.click(checkbox());

            expect(onToggle).toHaveBeenCalledOnce();
        });

        it("isn't in the tab order", () => {
            renderTile();

            expect(checkbox()).toHaveAttribute("tabindex", "-1");
        });
    });

    describe("marked look", () => {
        it("shows Delete in place of Best on a marked best file", () => {
            const { container } = renderTile({ best: true, marked: true });

            expect(screen.getByText("Delete")).toBeInTheDocument();
            expect(screen.queryByText("Best")).not.toBeInTheDocument();
            expect(container.querySelector(".ring-\\[\\#EF4444\\]")).not.toBeNull();
            expect(container.querySelector(".ring-primary")).toBeNull();
        });

        it("washes the picture and strikes the name of a marked copy", () => {
            const { container } = renderTile({ marked: true });

            expect(container.querySelector(".bg-\\[rgba\\(69\\,10\\,10\\,0\\.62\\)\\]")).not.toBeNull();
            expect(screen.getByText("IMG_2041 (1).jpg")).toHaveClass("line-through", "text-[#A1A1AA]");
        });

        it("keeps a marked video's duration", () => {
            renderTile({ file: VIDEO, marked: true });

            expect(screen.getByText("0:42")).toBeInTheDocument();
            expect(screen.getByText("Delete")).toBeInTheDocument();
        });

        it("shows none of it on an unmarked tile", () => {
            const { container } = renderTile({ best: true });

            expect(screen.queryByText("Delete")).not.toBeInTheDocument();
            expect(screen.getByText("Best")).toBeInTheDocument();
            expect(container.querySelector(".line-through")).toBeNull();
            expect(container.querySelector(".ring-\\[\\#EF4444\\]")).toBeNull();
        });
    });
});
