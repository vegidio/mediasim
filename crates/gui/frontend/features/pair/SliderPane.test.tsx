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
});
