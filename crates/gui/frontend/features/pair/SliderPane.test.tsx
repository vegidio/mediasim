import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import type { Details } from "./details";
import { SliderPane } from "./SliderPane";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const media = (name: string, type: MediaFile["type"] = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

const LOADING: Details = { status: "loading" };
const DETAILS = { a: LOADING, b: LOADING };
const UNMARKED = { marked: { a: false, b: false }, onToggleMark: () => {} };

const IMAGES = { a: media("IMG_2041.jpg"), b: media("IMG_2041-edit.jpg") };
const VIDEOS = { a: media("a.mp4", "video"), b: media("b.mp4", "video") };

const pane = () => screen.getByRole("article", { name: "Files A and B" });

describe("SliderPane", () => {
    it("names A on the left and B on the right, each truncated with a title, with their mark buttons inward", () => {
        render(<SliderPane files={IMAGES} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />);

        const header = pane().firstElementChild as HTMLElement;
        expect([...header.children].map((child) => child.textContent)).toEqual([
            "A",
            "IMG_2041.jpg",
            "Mark A for deletion",
            "",
            "Mark B for deletion",
            "IMG_2041-edit.jpg",
            "B",
        ]);
        expect(
            within(header)
                .getAllByRole("button")
                .map((button) => button.textContent),
        ).toEqual(["Mark A for deletion", "Mark B for deletion"]);
        for (const name of ["IMG_2041.jpg", "IMG_2041-edit.jpg"]) {
            expect(within(header).getByText(name)).toHaveAttribute("title", name);
            expect(within(header).getByText(name)).toHaveClass("truncate");
        }
    });

    it("asks for both 2048 renditions", () => {
        const { container } = render(
            <SliderPane files={IMAGES} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
        );

        expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src")).sort()).toEqual([
            "thumb://localhost/id-IMG_2041-edit.jpg?size=2048",
            "thumb://localhost/id-IMG_2041.jpg?size=2048",
        ]);
    });

    it.each([
        ["images", IMAGES],
        ["videos", VIDEOS],
    ])("shows the slider and the details table for %s", (_, files) => {
        render(<SliderPane files={files} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />);

        expect(within(pane()).getByRole("slider", { name: "Drag to compare A and B" })).toBeInTheDocument();
        expect(within(pane()).getByRole("table")).toBeInTheDocument();
    });

    it("plays nothing for videos", () => {
        const { container } = render(
            <SliderPane files={VIDEOS} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
        );

        expect(container.querySelector("video")).not.toBeInTheDocument();
        // The mark buttons are the only buttons: there is no play control.
        expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
            "Mark A for deletion",
            "Mark B for deletion",
        ]);
    });

    it("marks each file from its own button", () => {
        const onToggleMark = vi.fn();
        render(
            <SliderPane
                files={IMAGES}
                details={DETAILS}
                position={50}
                onPositionChange={() => {}}
                marked={{ a: false, b: false }}
                onToggleMark={onToggleMark}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
        fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));

        expect(onToggleMark.mock.calls).toEqual([["b"], ["a"]]);
    });

    it("names a marked file's button with its badge, and tags it on the stage", () => {
        render(
            <SliderPane
                files={IMAGES}
                details={DETAILS}
                position={50}
                onPositionChange={() => {}}
                marked={{ a: true, b: false }}
                onToggleMark={() => {}}
            />,
        );

        expect(screen.getByRole("button", { name: "A Marked · Undo" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mark B for deletion" })).toBeInTheDocument();
        expect(screen.getByTestId("delete-tag-a")).toHaveTextContent("A · Delete");
        expect(screen.queryByTestId("delete-tag-b")).not.toBeInTheDocument();
    });

    describe("gone", () => {
        const B_GONE = { a: false, b: true };

        it("shows In Trash for B in place of its button, with its name struck through and its badge dashed", () => {
            render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    trashed={B_GONE}
                />,
            );

            const header = pane().firstElementChild as HTMLElement;
            expect([...header.children].map((child) => child.textContent)).toEqual([
                "A",
                "IMG_2041.jpg",
                "Mark A for deletion",
                "",
                "In Trash",
                "IMG_2041-edit.jpg",
                "B",
            ]);
            expect(within(header).queryByRole("button", { name: /B/ })).not.toBeInTheDocument();
            expect(within(header).getByText("In Trash").querySelector(".lucide-trash-2")).toHaveAttribute(
                "aria-hidden",
                "true",
            );
            expect(within(header).getByText("IMG_2041-edit.jpg")).toHaveClass("line-through", "text-text-disabled");
            expect(within(header).getByText("B")).toHaveClass("border-dashed");
            expect(within(header).getByText("IMG_2041.jpg")).not.toHaveClass("line-through");
        });

        it("shows only A's picture on the stage, with no slider", () => {
            const { container } = render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    trashed={B_GONE}
                />,
            );

            const stage = screen.getByTestId("slider-stage");
            expect(within(stage).queryByRole("slider")).not.toBeInTheDocument();
            expect([...stage.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
                "thumb://localhost/id-IMG_2041.jpg?size=2048",
            ]);
            expect(container.querySelector('[data-testid="slider-a"]')).not.toBeInTheDocument();
        });

        it("keeps A's mark button and its tag working", () => {
            const onToggleMark = vi.fn();
            const { container, rerender } = render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    marked={{ a: false, b: false }}
                    onToggleMark={onToggleMark}
                    trashed={B_GONE}
                />,
            );

            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));
            expect(onToggleMark).toHaveBeenCalledExactlyOnceWith("a");

            rerender(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    marked={{ a: true, b: false }}
                    onToggleMark={onToggleMark}
                    trashed={B_GONE}
                />,
            );
            fireEvent.load(container.querySelector("img") as HTMLImageElement);

            expect(screen.getByTestId("delete-tag-a")).toHaveTextContent("A · Delete");
            expect(screen.getByRole("button", { name: "A Marked · Undo" })).toBeInTheDocument();
        });

        it("shows a placeholder on the stage when both are gone", () => {
            render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    trashed={{ a: true, b: true }}
                />,
            );

            const stage = screen.getByTestId("slider-stage");
            expect(stage).toHaveTextContent("Both files moved to Trash");
            expect(stage.querySelector("img")).not.toBeInTheDocument();
            expect(screen.queryByRole("slider")).not.toBeInTheDocument();
            expect(screen.getAllByText("In Trash")).toHaveLength(2);
        });

        it("fades and strikes through B's row in the details, keeping its values", () => {
            const ready = (width: number): Details => ({
                status: "ready",
                info: { path: "/x", type: "image", width, height: 100, size: 1000 },
            });
            render(
                <SliderPane
                    files={IMAGES}
                    details={{ a: ready(200), b: ready(100) }}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    trashed={B_GONE}
                />,
            );

            const [, rowA, rowB] = screen.getAllByRole("row");
            expect(rowB).toHaveClass("opacity-40", "line-through");
            expect(rowB).toHaveTextContent("100 × 100");
            expect(rowA).not.toHaveClass("opacity-40");
            expect(rowA).toHaveTextContent("200 × 100Higher");
        });
    });
});
