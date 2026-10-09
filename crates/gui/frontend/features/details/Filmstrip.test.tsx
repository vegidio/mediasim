import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { Filmstrip } from "./Filmstrip";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const FILES: MediaFile[] = ["IMG_2041.jpg", "IMG_2041 (1).jpg", "IMG_2041-edit.jpg"].map((name, i) => ({
    path: `/p/${name}`,
    name,
    type: "image",
    size: 1,
    identity: `id${i}`.padEnd(16, "0"),
}));

const thumb = (name: string) => screen.getByRole("button", { name });
const washed = (button: HTMLElement) => button.querySelector('[data-testid="strip-marked"]');

describe("Filmstrip", () => {
    it("without marks, rings the current file in lime and shows the others at 70%", () => {
        render(<Filmstrip files={FILES} index={0} onShow={() => {}} />);

        expect(thumb("Show IMG_2041.jpg")).toHaveClass("shadow-[0_0_0_2px_#BEF264]");
        expect(thumb("Show IMG_2041.jpg")).toHaveAttribute("aria-current", "true");
        for (const name of ["Show IMG_2041 (1).jpg", "Show IMG_2041-edit.jpg"]) {
            expect(thumb(name)).toHaveClass("opacity-70");
            expect(thumb(name)).not.toHaveClass("shadow-[0_0_0_2px_#EF4444]");
            expect(washed(thumb(name))).toBeNull();
        }
    });

    it("rings a marked file that isn't shown in red, washed, at full opacity, and names it marked", () => {
        render(<Filmstrip files={FILES} index={0} onShow={() => {}} marks={new Set([FILES[2]?.path ?? ""])} />);
        const marked = thumb("Show IMG_2041-edit.jpg, marked for deletion");

        expect(marked).toHaveClass("shadow-[0_0_0_2px_#EF4444]");
        expect(marked).not.toHaveClass("opacity-70");
        expect(washed(marked)?.querySelector("svg.lucide-trash-2")).not.toBeNull();
        expect(thumb("Show IMG_2041 (1).jpg")).toHaveClass("opacity-70");
    });

    it("keeps the lime ring on a marked current file, with the wash", () => {
        render(<Filmstrip files={FILES} index={1} onShow={() => {}} marks={new Set([FILES[1]?.path ?? ""])} />);
        const current = thumb("Show IMG_2041 (1).jpg, marked for deletion");

        expect(current).toHaveClass("shadow-[0_0_0_2px_#BEF264]");
        expect(current).not.toHaveClass("shadow-[0_0_0_2px_#EF4444]");
        expect(washed(current)).not.toBeNull();
    });

    it("fades the picture of a file out of the comparison, keeping the current file's ring bright", () => {
        render(<Filmstrip files={FILES} index={0} onShow={() => {}} isDimmed={(file) => file !== FILES[1]} />);
        const picture = (name: string) => thumb(name).querySelector('[data-testid="strip-picture"]');

        expect(picture("Show IMG_2041.jpg")).toHaveClass("opacity-28", "grayscale");
        expect(thumb("Show IMG_2041.jpg")).toHaveClass("shadow-[0_0_0_2px_#BEF264]");
        expect(thumb("Show IMG_2041.jpg")).not.toHaveClass("grayscale");
        expect(picture("Show IMG_2041 (1).jpg")).not.toHaveClass("grayscale");
        expect(picture("Show IMG_2041-edit.jpg")).toHaveClass("opacity-28", "grayscale");
    });

    it("shows the file whose thumbnail is activated", () => {
        const onShow = vi.fn();
        render(<Filmstrip files={FILES} index={0} onShow={onShow} />);

        fireEvent.click(thumb("Show IMG_2041-edit.jpg"));

        expect(onShow).toHaveBeenCalledExactlyOnceWith(FILES[2]);
    });
});
