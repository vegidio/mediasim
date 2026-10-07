import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import type { GoneKind } from "@/stores/pairResult";
import type { Details } from "./details";
import { SliderPane } from "./SliderPane";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    // H.264 and AAC in MP4, which the test setup's `canPlayType` plays directly; a `-dts.mkv` file has DTS sound that
    // can be neither played nor decoded, and a `-silent.mkv` file has none, so both are remuxed.
    probeVideo: async (identity: string) => ({
        format: identity.endsWith(".mkv") ? "matroska,webm" : "mov,mp4,m4a,3gp,3g2,mj2",
        duration: 42,
        video: { codec: "h264", codecString: "avc1.640028", decodable: true },
        ...(identity.endsWith("-dts.mkv") && { audio: { codec: "dts", decodable: false } }),
        ...(identity.endsWith(".mp4") && { audio: { codec: "aac", codecString: "mp4a.40.2", decodable: true } }),
    }),
    // A session for an `.mkv` file works; any other, which an error before the first frame falls back to, fails too:
    // those files can't be played at all.
    videoOpen: vi.fn(async (identity: string) => {
        if (identity.endsWith(".mkv")) return { session: 1, start: 0 };
        throw { kind: "unreadable", message: "not a video" };
    }),
    videoNext: vi.fn(async () => new ArrayBuffer(0)),
    videoClose: vi.fn(async () => {}),
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

    describe("two videos", () => {
        const videos = (container: HTMLElement) => [...container.querySelectorAll("video")];

        it("shows one player for both, and both videos hidden behind their stills", async () => {
            const { container } = render(
                <SliderPane files={VIDEOS} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
            );
            await act(async () => {});

            expect(screen.getAllByRole("group")).toHaveLength(1);
            expect(screen.getByRole("group", { name: "Player for A and B" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Unmute A" })).toBeInTheDocument();
            expect(videos(container).map((video) => video.getAttribute("src"))).toEqual([
                "video://localhost/id-b.mp4",
                "video://localhost/id-a.mp4",
            ]);
            for (const video of videos(container)) {
                expect(video).toHaveClass("invisible");
                expect(video.paused).toBe(true);
                expect(video.muted).toBe(true);
            }
        });

        it.each([
            ["A has", { a: media("a-dts.mkv", "video"), b: media("b.mp4", "video") }, "No playable sound in A"],
            ["only B has", { a: media("a.mp4", "video"), b: media("b-dts.mkv", "video") }, "Unmute A"],
        ])("names the mute button for A's sound when %s no playable sound", async (_, files, name) => {
            render(
                <SliderPane files={files} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
            );
            await act(async () => {});

            const mute = screen.getByRole("button", { name });
            expect(mute).toHaveAttribute("aria-label", name);
            if (name === "Unmute A") {
                expect(mute).toBeEnabled();
                fireEvent.click(mute);
                expect(screen.getByRole("button", { name: "Mute A" })).toBeInTheDocument();
            } else {
                expect(mute).toBeDisabled();
            }
            fireEvent.click(screen.getByRole("button", { name: "Play A and B" }));
            expect(screen.getByRole("button", { name: "Pause A and B" })).toBeInTheDocument();
        });

        it("keeps a working mute button when A has no audio stream at all", async () => {
            const files = { a: media("a-silent.mkv", "video"), b: media("b.mp4", "video") };
            render(
                <SliderPane files={files} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
            );
            await act(async () => {});

            expect(screen.getByRole("button", { name: "Unmute A" })).toBeEnabled();
        });

        it("plays and reveals both from Play A and B", async () => {
            const { container } = render(
                <SliderPane files={VIDEOS} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
            );
            await act(async () => {});

            fireEvent.click(screen.getByRole("button", { name: "Play A and B" }));

            for (const video of videos(container)) {
                expect(video.paused).toBe(false);
                expect(video).not.toHaveClass("invisible");
            }
            expect(screen.getByRole("button", { name: "Pause A and B" })).toBeInTheDocument();
        });

        it("hides both videos and shows the note in place of the bar when B can't play", () => {
            const { container } = render(
                <SliderPane files={VIDEOS} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
            );
            fireEvent.click(screen.getByRole("button", { name: "Play A and B" }));
            const [videoB, videoA] = videos(container) as [HTMLVideoElement, HTMLVideoElement];

            fireEvent.error(videoB);

            expect(screen.getByTestId("slider-bar")).toHaveTextContent("Can't play this format yet");
            expect(screen.queryByRole("group")).not.toBeInTheDocument();
            for (const video of [videoA, videoB]) {
                expect(video).toHaveClass("invisible");
                expect(video.paused).toBe(true);
            }
            expect(screen.getByRole("slider", { name: "Drag to compare A and B" })).toBeInTheDocument();
        });

        it("washes A over its playing video when marked, keeping both playing and the bar working", async () => {
            const props = { files: VIDEOS, details: DETAILS, position: 50, onPositionChange: () => {} };
            const { container, rerender } = render(<SliderPane {...props} {...UNMARKED} />);
            await act(async () => {});
            fireEvent.click(screen.getByRole("button", { name: "Play A and B" }));
            const [videoB, videoA] = videos(container) as [HTMLVideoElement, HTMLVideoElement];
            fireEvent.load(container.querySelector('img[src^="thumb://localhost/id-a.mp4"]') as HTMLImageElement);

            rerender(<SliderPane {...props} marked={{ a: true, b: false }} onToggleMark={() => {}} />);

            const wash = screen.getByTestId("mark-wash");
            expect(screen.getByTestId("slider-a")).toContainElement(wash);
            expect(videoA.compareDocumentPosition(wash)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            expect(screen.getByTestId("delete-tag-a")).toHaveTextContent("A · Delete");
            expect(wash.compareDocumentPosition(screen.getByTestId("slider-bar"))).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(videoA.paused).toBe(false);
            expect(videoB.paused).toBe(false);

            fireEvent.click(screen.getByRole("button", { name: "Pause A and B" }));

            expect(videoA.paused).toBe(true);
            expect(videoB.paused).toBe(true);
        });

        it("shows no player for two images", () => {
            const { container } = render(
                <SliderPane files={IMAGES} details={DETAILS} position={50} onPositionChange={() => {}} {...UNMARKED} />,
            );

            expect(container.querySelector("video")).not.toBeInTheDocument();
            expect(screen.queryByRole("group")).not.toBeInTheDocument();
            expect(screen.queryByTestId("slider-bar")).not.toBeInTheDocument();
        });
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
        const B_GONE: Partial<Record<"a" | "b", GoneKind>> = { b: "trash" };

        it("shows In Trash for B in place of its button, with its name struck through and its badge dashed", () => {
            render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={B_GONE}
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

        it("shows Deleted for a deleted B, with its name struck through", () => {
            render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={{ b: "deleted" }}
                />,
            );

            const header = pane().firstElementChild as HTMLElement;
            expect(within(header).getByText("Deleted").querySelector(".lucide-trash-2")).toBeInTheDocument();
            expect(within(header).queryByText("In Trash")).not.toBeInTheDocument();
            expect(within(header).getByText("IMG_2041-edit.jpg")).toHaveClass("line-through");
            expect(within(screen.getByTestId("slider-stage")).queryByRole("slider")).not.toBeInTheDocument();
            expect(screen.getAllByRole("row")[2]).toHaveClass("line-through");
        });

        it("shows only A's picture on the stage, with no slider", () => {
            const { container } = render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={B_GONE}
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
                    gone={B_GONE}
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
                    gone={B_GONE}
                />,
            );
            fireEvent.load(container.querySelector("img") as HTMLImageElement);

            expect(screen.getByTestId("delete-tag-a")).toHaveTextContent("A · Delete");
            expect(screen.getByRole("button", { name: "A Marked · Undo" })).toBeInTheDocument();
        });

        it("gives a remaining video its own player, which plays it alone", async () => {
            const files = { a: media("VID_0714.mov", "video"), b: media("VID_0714-edit.mov", "video") };
            const { container } = render(
                <SliderPane
                    files={files}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={B_GONE}
                />,
            );
            await act(async () => {});

            expect(screen.getByRole("group", { name: "Player for VID_0714.mov" })).toBeInTheDocument();
            expect(screen.queryByRole("group", { name: "Player for A and B" })).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "Play VID_0714.mov" }));

            const videos = container.querySelectorAll("video");
            expect(videos).toHaveLength(1);
            expect(videos[0]).toHaveAttribute("src", "video://localhost/id-VID_0714.mov");
            expect((videos[0] as HTMLVideoElement).paused).toBe(false);
        });

        it("gives no player when both videos are gone", () => {
            const { container } = render(
                <SliderPane
                    files={VIDEOS}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={{ a: "trash", b: "trash" }}
                />,
            );

            expect(screen.getByTestId("slider-stage")).toHaveTextContent("Both files moved to Trash");
            expect(container.querySelector("video")).not.toBeInTheDocument();
            expect(screen.queryByRole("group")).not.toBeInTheDocument();
        });

        it("gives a remaining image no player", () => {
            const { container } = render(
                <SliderPane
                    files={{ a: IMAGES.a, b: VIDEOS.b }}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={B_GONE}
                />,
            );

            expect(container.querySelector("video")).not.toBeInTheDocument();
            expect(screen.queryByRole("group")).not.toBeInTheDocument();
        });

        it("shows a placeholder on the stage when both are gone", () => {
            render(
                <SliderPane
                    files={IMAGES}
                    details={DETAILS}
                    position={50}
                    onPositionChange={() => {}}
                    {...UNMARKED}
                    gone={{ a: "trash", b: "trash" }}
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
                    gone={B_GONE}
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
