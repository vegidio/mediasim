import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaInfo } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import type { GoneKind } from "@/stores/pairResult";
import type { Details } from "./details";
import { MediaPane } from "./MediaPane";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const IMAGE: MediaFile = {
    path: "/Pictures/IMG_2041.jpg",
    name: "IMG_2041.jpg",
    type: "image",
    size: 4_800_000,
    identity: "0123456789abcdef",
};

const VIDEO: MediaFile = {
    path: "/Movies/clip.mp4",
    name: "clip.mp4",
    type: "video",
    size: 312_000_000,
    identity: "fedcba9876543210",
};

const imageInfo = (info: Partial<MediaInfo> = {}): MediaInfo => ({
    path: IMAGE.path,
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_800_000,
    format: "JPEG",
    colorProfile: "Display P3",
    created: new Date(2025, 6, 14, 20, 41).toISOString(),
    ...info,
});

const videoInfo: MediaInfo = {
    path: VIDEO.path,
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42.6,
    frameRate: 30000 / 1001,
};

const ready = (info: MediaInfo): Details => ({ status: "ready", info });
const LOADING: Details = { status: "loading" };
const UNMARKED = { marked: false, onToggleMark: () => {} };

const pane = (name: string) => screen.getByRole("article", { name });

/** The pane's details as `[key, value]` pairs, in order. */
const details = (name: string) =>
    within(pane(name))
        .getAllByRole("term")
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]);

/** The pane's picture, which is decorative and so has no accessible role. */
const picture = (container: HTMLElement) => container.querySelector("img") as HTMLImageElement;

describe("MediaPane", () => {
    it("shows the badge and the full name, truncated with a title", () => {
        render(<MediaPane slot="a" file={IMAGE} details={LOADING} other={LOADING} {...UNMARKED} />);

        expect(within(pane("File A")).getByText("A", { ignore: ".sr-only" })).toBeInTheDocument();
        expect(within(pane("File A")).getByText("IMG_2041.jpg")).toHaveAttribute("title", "IMG_2041.jpg");
        expect(within(pane("File A")).getByText("IMG_2041.jpg")).toHaveClass("truncate");
    });

    it("lists an image's details in order", () => {
        render(<MediaPane slot="a" file={IMAGE} details={ready(imageInfo())} other={LOADING} {...UNMARKED} />);

        expect(details("File A")).toEqual([
            ["Resolution", "4032 × 3024"],
            ["File size", "4.8 MB"],
            ["Format", "JPEG · Display P3"],
            ["Created", "2025-07-14 20:41"],
        ]);
    });

    it("lists a video's details in order", () => {
        render(<MediaPane slot="b" file={VIDEO} details={ready(videoInfo)} other={LOADING} {...UNMARKED} />);

        expect(details("File B")).toEqual([
            ["Duration", "0:42"],
            ["Resolution", "1920 × 1080"],
            ["Frame rate", "29.97 fps"],
            ["File size", "312.0 MB"],
        ]);
    });

    it("shows a placeholder for every value while loading", () => {
        render(<MediaPane slot="a" file={VIDEO} details={LOADING} other={LOADING} {...UNMARKED} />);

        expect(within(pane("File A")).getAllByTestId("detail-placeholder")).toHaveLength(4);
    });

    it("shows Unknown for every value after a failed probe", () => {
        render(
            <MediaPane slot="a" file={IMAGE} details={{ status: "failed" }} other={ready(imageInfo())} {...UNMARKED} />,
        );

        expect(details("File A").map(([, value]) => value)).toEqual(["Unknown", "Unknown", "Unknown", "Unknown"]);
        expect(within(pane("File A")).queryAllByTestId("detail-placeholder")).toHaveLength(0);
    });

    it("puts each badge after its value", () => {
        const other = imageInfo({ width: 2048, height: 1536, created: new Date(2025, 7, 2).toISOString() });
        render(<MediaPane slot="a" file={IMAGE} details={ready(imageInfo())} other={ready(other)} {...UNMARKED} />);

        const resolution = within(pane("File A")).getByText("Resolution").nextElementSibling as HTMLElement;
        expect(resolution).toHaveTextContent("4032 × 3024Higher");
        expect(within(resolution).getByText("Higher").previousElementSibling).toHaveTextContent("4032 × 3024");
        expect(details("File A")[3]).toEqual(["Created", "2025-07-14 20:41Older"]);
    });

    it("asks for the 2048 rendition, fitted whole", () => {
        const { container } = render(
            <MediaPane slot="a" file={IMAGE} details={LOADING} other={LOADING} {...UNMARKED} />,
        );

        expect(picture(container)).toHaveAttribute("src", "thumb://localhost/0123456789abcdef?size=2048");
        expect(picture(container)).toHaveAttribute("alt", "");
        expect(picture(container)).toHaveClass("object-contain");
    });

    it("shows the kind icon until the picture loads", () => {
        const { container } = render(
            <MediaPane slot="a" file={IMAGE} details={LOADING} other={LOADING} {...UNMARKED} />,
        );

        expect(picture(container)).toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).toBeInTheDocument();

        fireEvent.load(picture(container));

        expect(picture(container)).not.toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).not.toBeInTheDocument();
    });

    it("keeps the kind icon, name and details when the picture can't be produced", () => {
        const { container } = render(
            <MediaPane slot="b" file={VIDEO} details={ready(videoInfo)} other={LOADING} {...UNMARKED} />,
        );

        fireEvent.error(picture(container));

        expect(picture(container)).toHaveClass("invisible");
        expect(container.querySelector(".lucide-video")).toBeInTheDocument();
        expect(screen.getByText("clip.mp4")).toBeInTheDocument();
        expect(details("File B")[0]).toEqual(["Duration", "0:42"]);
    });

    it("plays nothing for a video", () => {
        const { container } = render(
            <MediaPane slot="b" file={VIDEO} details={ready(videoInfo)} other={LOADING} {...UNMARKED} />,
        );

        expect(container.querySelector("video")).not.toBeInTheDocument();
    });

    describe("marking", () => {
        const wash = (container: HTMLElement) => container.querySelector("[data-testid='mark-wash']");

        it("puts the mark button in the header, after the name", () => {
            render(<MediaPane slot="b" file={IMAGE} details={LOADING} other={LOADING} {...UNMARKED} />);

            const name = within(pane("File B")).getByText("IMG_2041.jpg");
            const button = within(pane("File B")).getByRole("button", { name: "Mark B for deletion" });
            expect(name.nextElementSibling).toBe(button);
            expect(name).toHaveClass("flex-1", "truncate");
        });

        it("calls onToggleMark from the button", () => {
            const onToggleMark = vi.fn();
            render(
                <MediaPane
                    slot="a"
                    file={IMAGE}
                    details={LOADING}
                    other={LOADING}
                    marked={false}
                    onToggleMark={onToggleMark}
                />,
            );

            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));

            expect(onToggleMark).toHaveBeenCalledOnce();
        });

        it("shows no wash and no pill while unmarked", () => {
            const { container } = render(
                <MediaPane slot="a" file={IMAGE} details={LOADING} other={LOADING} {...UNMARKED} />,
            );

            expect(wash(container)).not.toBeInTheDocument();
            expect(screen.queryByText("Delete")).not.toBeInTheDocument();
        });

        it("washes the picture red with a hidden Delete pill while marked, click-through", () => {
            const { container } = render(
                <MediaPane slot="a" file={IMAGE} details={LOADING} other={LOADING} marked onToggleMark={() => {}} />,
            );
            fireEvent.load(picture(container));

            // Inside the picture's own frame, so the dotted space beside the picture stays clear.
            expect(screen.getByTestId("picture-frame")).toContainElement(wash(container) as HTMLElement);
            expect(wash(container)).toHaveClass(
                "pointer-events-none",
                "inset-0",
                "bg-[rgba(69,10,10,.62)]",
                "shadow-[inset_0_0_0_2px_#EF4444]",
            );
            const pill = within(wash(container) as HTMLElement).getByText("Delete");
            expect(pill).toHaveAttribute("aria-hidden", "true");
            expect(pill.querySelector(".lucide-trash-2")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "A Marked · Undo" })).toBeInTheDocument();
        });

        it("paints nothing until the picture loads, showing the kind icon unwashed", () => {
            const { container } = render(
                <MediaPane slot="b" file={VIDEO} details={LOADING} other={LOADING} marked onToggleMark={() => {}} />,
            );

            expect(container.querySelector(".lucide-video")).toBeInTheDocument();
            expect(wash(container)).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "B Marked · Undo" })).toBeInTheDocument();
        });
    });

    describe("gone", () => {
        const EDIT: MediaFile = { ...IMAGE, name: "IMG_2041-edit.jpg", size: 1_100_000, identity: "fedcba9876543210" };
        const smaller = imageInfo({ width: 2048, height: 1536, created: new Date(2025, 7, 2).toISOString() });

        const both = ({
            onRestore = () => {},
            restoring = false,
            gone = "trash",
        }: {
            onRestore?: () => void;
            restoring?: boolean;
            gone?: GoneKind;
        } = {}) =>
            render(
                <>
                    <MediaPane
                        slot="a"
                        file={IMAGE}
                        details={ready(imageInfo())}
                        other={ready(smaller)}
                        {...UNMARKED}
                    />
                    <MediaPane
                        slot="b"
                        file={EDIT}
                        details={ready(smaller)}
                        other={ready(imageInfo())}
                        {...UNMARKED}
                        gone={gone}
                        onRestore={onRestore}
                        restoring={restoring}
                    />
                </>,
            );

        it("replaces a moved file's pane with a dashed placeholder, with no picture, details or mark button", () => {
            both();

            const gone = pane("File B");
            expect(gone).toHaveClass("border-dashed");
            expect(gone).toHaveTextContent("IMG_2041-edit.jpgMoved to Trash · 1.1 MB freedUndo");
            expect(gone.querySelector(".lucide-trash-2")).toHaveAttribute("aria-hidden", "true");
            expect(within(gone).getAllByRole("button")).toHaveLength(1);
            expect(within(gone).queryByRole("button", { name: /^Mark/ })).not.toBeInTheDocument();
            expect(gone.querySelector("img")).not.toBeInTheDocument();
            expect(gone.querySelector("dl")).not.toBeInTheDocument();
        });

        it("shows a deleted file's placeholder with no Undo", () => {
            both({ gone: "deleted" });

            const gone = pane("File B");
            expect(gone).toHaveClass("border-dashed");
            expect(gone).toHaveTextContent(/^IMG_2041-edit\.jpgDeleted permanently · 1\.1 MB freed$/);
            expect(within(gone).queryByRole("button")).not.toBeInTheDocument();
        });

        it("leaves the other pane whole, with its button, picture and badges", () => {
            both();

            const kept = pane("File A");
            expect(within(kept).getByRole("button", { name: "Mark A for deletion" })).toBeInTheDocument();
            expect(kept.querySelector("img")).toBeInTheDocument();
            expect(details("File A")[0]).toEqual(["Resolution", "4032 × 3024Higher"]);
            expect(details("File A")[3]).toEqual(["Created", "2025-07-14 20:41Older"]);
        });

        it("offers Undo under the Moved to Trash line, named with the file", () => {
            both();

            const undo = within(pane("File B")).getByRole("button", { name: "Undo moving IMG_2041-edit.jpg to Trash" });
            expect(undo).toHaveTextContent(/^Undo$/);
            expect(undo).toBeEnabled();
        });

        it("calls onRestore from Undo", () => {
            const onRestore = vi.fn();
            both({ onRestore });

            fireEvent.click(screen.getByRole("button", { name: "Undo moving IMG_2041-edit.jpg to Trash" }));

            expect(onRestore).toHaveBeenCalledOnce();
        });

        it("disables Undo while restoring", () => {
            const onRestore = vi.fn();
            both({ onRestore, restoring: true });

            const undo = screen.getByRole("button", { name: "Undo moving IMG_2041-edit.jpg to Trash" });
            fireEvent.click(undo);

            expect(undo).toBeDisabled();
            expect(onRestore).not.toHaveBeenCalled();
        });
    });
});
