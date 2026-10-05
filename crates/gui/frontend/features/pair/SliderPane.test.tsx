import { render, screen, within } from "@testing-library/react";
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

const IMAGES = { a: media("IMG_2041.jpg"), b: media("IMG_2041-edit.jpg") };
const VIDEOS = { a: media("a.mp4", "video"), b: media("b.mp4", "video") };

const pane = () => screen.getByRole("article", { name: "Files A and B" });

describe("SliderPane", () => {
    it("names A on the left and B on the right, each truncated with a title", () => {
        render(<SliderPane files={IMAGES} details={DETAILS} position={50} onPositionChange={() => {}} />);

        const header = pane().firstElementChild as HTMLElement;
        expect([...header.children].map((child) => child.textContent)).toEqual([
            "A",
            "IMG_2041.jpg",
            "",
            "IMG_2041-edit.jpg",
            "B",
        ]);
        for (const name of ["IMG_2041.jpg", "IMG_2041-edit.jpg"]) {
            expect(within(header).getByText(name)).toHaveAttribute("title", name);
            expect(within(header).getByText(name)).toHaveClass("truncate");
        }
    });

    it("asks for both 2048 renditions", () => {
        const { container } = render(
            <SliderPane files={IMAGES} details={DETAILS} position={50} onPositionChange={() => {}} />,
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
        render(<SliderPane files={files} details={DETAILS} position={50} onPositionChange={() => {}} />);

        expect(within(pane()).getByRole("slider", { name: "Drag to compare A and B" })).toBeInTheDocument();
        expect(within(pane()).getByRole("table")).toBeInTheDocument();
    });

    it("plays nothing for videos", () => {
        const { container } = render(
            <SliderPane files={VIDEOS} details={DETAILS} position={50} onPositionChange={() => {}} />,
        );

        expect(container.querySelector("video")).not.toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
});
