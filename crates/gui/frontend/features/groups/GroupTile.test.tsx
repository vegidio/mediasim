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

const renderTile = ({ file = IMAGE, best = false, marked = false, onToggle = () => {} } = {}) =>
    render(<GroupTile file={file} best={best} large={false} marked={marked} onToggle={onToggle} />);

const checkbox = () => screen.getByRole("checkbox", { name: "Mark IMG_2041 (1).jpg for deletion" });

describe("GroupTile", () => {
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

        it("is a focusable native button, which the browser toggles on Space", () => {
            // jsdom doesn't turn Space on a button into a click, so this checks what makes the browser do it.
            renderTile();

            checkbox().focus();

            expect(checkbox()).toHaveFocus();
            expect(checkbox().tagName).toBe("BUTTON");
            expect(checkbox()).toHaveAttribute("type", "button");
        });
    });

    describe("marked look", () => {
        it("shows Delete in place of Keep on a marked best file, which still reads best", () => {
            const { container } = renderTile({ best: true, marked: true });

            expect(screen.getByText("Delete")).toBeInTheDocument();
            expect(screen.queryByText("Keep")).not.toBeInTheDocument();
            expect(screen.getByText("best")).toBeInTheDocument();
            expect(container.querySelector(".ring-\\[\\#EF4444\\]")).not.toBeNull();
            expect(container.querySelector(".ring-primary")).toBeNull();
        });

        it("washes the picture and strikes the name of a marked copy", () => {
            const { container } = renderTile({ marked: true });

            expect(container.querySelector(".bg-\\[rgba\\(69\\,10\\,10\\,0\\.62\\)\\]")).not.toBeNull();
            expect(screen.getByText("IMG_2041 (1).jpg")).toHaveClass("line-through", "text-[#A1A1AA]");
        });

        it("keeps a marked video's duration", () => {
            render(<GroupTile file={VIDEO} best={false} large={false} marked onToggle={() => {}} />);

            expect(screen.getByText("0:42")).toBeInTheDocument();
            expect(screen.getByText("Delete")).toBeInTheDocument();
        });

        it("shows none of it on an unmarked tile", () => {
            const { container } = renderTile({ best: true });

            expect(screen.queryByText("Delete")).not.toBeInTheDocument();
            expect(screen.getByText("Keep")).toBeInTheDocument();
            expect(container.querySelector(".line-through")).toBeNull();
            expect(container.querySelector(".ring-\\[\\#EF4444\\]")).toBeNull();
        });
    });
});
