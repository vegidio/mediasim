import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type MediaInfo, probeMedia } from "@/ipc/pair";
import type { GroupFile } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { useScanStore } from "@/stores/scan";
import { forgetFileDetails } from "../details/useFileDetails";
import type { GroupView } from "./GroupCard";
import { GroupDetailsDialog } from "./GroupDetailsDialog";

vi.mock("@/ipc/open", () => ({ openMedia: vi.fn(), revealMedia: vi.fn() }));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn() }));
vi.mock("@/ipc/set", () => ({ displayPath: vi.fn(async (path: string) => path), listSetMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    probeVideo: vi.fn(() => new Promise(() => {})),
    videoOpen: vi.fn(),
    videoNext: vi.fn(),
    videoClose: vi.fn(async () => {}),
}));

const NAMES = ["IMG_2041.jpg", "IMG_2041 (1).jpg", "IMG_2041-edit.jpg"];

const FILES: MediaFile[] = NAMES.map((name, i) => ({
    path: `/p/${name}`,
    name,
    type: "image",
    size: 1000,
    identity: `id${i}`.padEnd(16, "0"),
}));

/** The group, with its first file the best. */
const GROUP: GroupView = {
    files: FILES.map((file): GroupFile => ({ path: file.path, type: "image", width: 4032, height: 3024, size: 1000 })),
    best: 0,
};

const nth = (n: number) => FILES[n - 1] as MediaFile;

/** The dialog as the groups screen shows it, on whichever file it was last moved to. */
const Harness = ({ start }: { start: number }) => {
    const [shown, setShown] = useState(nth(start).path);
    const file = FILES.find((candidate) => candidate.path === shown) as MediaFile;

    return (
        <GroupDetailsDialog
            number={1}
            group={GROUP}
            files={FILES}
            file={file}
            onShow={setShown}
            onClose={() => {}}
            onClosed={() => {}}
        />
    );
};

const openOn = (n: number) => render(<Harness start={n} />);

const dialog = () => screen.getByRole("dialog");
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });

/** The chips above the sidebar's sections. */
const chips = () =>
    within(within(dialog()).getByRole("complementary", { name: "File details" }))
        .getAllByText(/^(Recommended keep|Image|Video|Marked for deletion|Not included|Removed)$/)
        .filter((chip) => !chip.closest("section"))
        .map((chip) => chip.textContent);

beforeEach(() => {
    forgetFileDetails();
    useScanStore.setState(useScanStore.getInitialState(), true);
    (probeMedia as Mock).mockReset().mockImplementation(
        async (path: string): Promise<MediaInfo> => ({
            path,
            type: "image",
            width: 4032,
            height: 3024,
            size: 1000,
        }),
    );
});

describe("GroupDetailsDialog", () => {
    it("is named after the file, and reads its position in the group", () => {
        openOn(1);

        expect(screen.getByRole("dialog", { name: "Media details: IMG_2041.jpg" })).toBeInTheDocument();
        expect(within(dialog()).getByText("Group 1 · 1 of 3")).toBeInTheDocument();
    });

    it("steps within the group with → and Next", () => {
        openOn(1);

        fireEvent.keyDown(dialog(), { key: "ArrowRight" });
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2041 (1).jpg");
        expect(within(dialog()).getByText("Group 1 · 2 of 3")).toBeInTheDocument();

        fireEvent.click(button("Next file"));
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2041-edit.jpg");
        expect(within(dialog()).getByText("Group 1 · 3 of 3")).toBeInTheDocument();
    });

    it("disables Next on the group's last file, where → does nothing and doesn't wrap", () => {
        openOn(3);

        expect(button("Next file")).toBeDisabled();

        fireEvent.keyDown(dialog(), { key: "ArrowRight" });
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2041-edit.jpg");
        expect(within(dialog()).getByText("Group 1 · 3 of 3")).toBeInTheDocument();
    });

    it("disables Previous on the group's first file", () => {
        openOn(1);

        expect(button("Previous file")).toBeDisabled();

        fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2041.jpg");
    });

    it("shows Recommended keep on the best file only", () => {
        openOn(1);
        expect(chips()).toEqual(["Recommended keep", "Image"]);

        fireEvent.click(button("Next file"));
        expect(chips()).toEqual(["Image"]);
    });

    it("marks the shown file and unmarks it, keeping focus on the button and the dialog on the file", () => {
        openOn(2);
        const mark = button("Mark for deletion");
        mark.focus();

        fireEvent.click(mark);

        expect(useScanStore.getState().marks).toEqual(new Set([nth(2).path]));
        expect(mark).toHaveAccessibleName("Unmark");
        expect(mark).toHaveFocus();
        expect(chips()).toEqual(["Image", "Marked for deletion"]);
        expect(button("Show IMG_2041 (1).jpg, marked for deletion")).toBeInTheDocument();
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2041 (1).jpg");
        expect(within(dialog()).getByText("Group 1 · 2 of 3")).toBeInTheDocument();

        fireEvent.click(mark);

        expect(useScanStore.getState().marks).toEqual(new Set());
        expect(mark).toHaveAccessibleName("Mark for deletion");
        expect(mark).toHaveFocus();
        expect(chips()).toEqual(["Image"]);
        expect(button("Show IMG_2041 (1).jpg")).toBeInTheDocument();
    });

    it("marks the shown file on Space and unmarks it on the next, with focus on Previous file", () => {
        openOn(2);
        const previous = button("Previous file");
        previous.focus();

        fireEvent.keyDown(previous, { key: " " });

        expect(useScanStore.getState().marks).toEqual(new Set([nth(2).path]));
        expect(button(/^(Unmark|Mark for deletion)$/)).toHaveAccessibleName("Unmark");
        expect(chips()).toEqual(["Image", "Marked for deletion"]);
        expect(button("Show IMG_2041 (1).jpg, marked for deletion")).toBeInTheDocument();
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2041 (1).jpg");
        expect(previous).toHaveFocus();

        fireEvent.keyDown(previous, { key: " " });

        expect(useScanStore.getState().marks).toEqual(new Set());
        expect(button(/^(Unmark|Mark for deletion)$/)).toHaveAccessibleName("Mark for deletion");
        expect(chips()).toEqual(["Image"]);
    });

    it("marks the shown file once while Space is held down", () => {
        openOn(2);

        fireEvent.keyDown(dialog(), { key: " " });
        fireEvent.keyDown(dialog(), { key: " ", repeat: true });
        fireEvent.keyDown(dialog(), { key: " ", repeat: true });

        expect(useScanStore.getState().marks).toEqual(new Set([nth(2).path]));
    });

    it("keeps Recommended keep on a marked best file", () => {
        openOn(1);

        fireEvent.click(button("Mark for deletion"));

        expect(useScanStore.getState().marks).toEqual(new Set([nth(1).path]));
        expect(chips()).toEqual(["Recommended keep", "Image", "Marked for deletion"]);
    });

    it("shows the strip's marks made elsewhere", () => {
        useScanStore.getState().setMarks([nth(2).path, nth(3).path]);
        openOn(1);

        expect(button("Show IMG_2041.jpg")).toBeInTheDocument();
        expect(button("Show IMG_2041 (1).jpg, marked for deletion")).toBeInTheDocument();
        expect(button("Show IMG_2041-edit.jpg, marked for deletion")).toBeInTheDocument();
    });

    it("never shows the gallery's chips or its comparison button", () => {
        openOn(1);

        for (const n of [1, 2, 3]) {
            if (n > 1) fireEvent.click(button("Next file"));
            fireEvent.click(button(/^(Mark for deletion|Unmark)$/));
            expect(chips()).not.toContain("Not included");
            expect(chips()).not.toContain("Removed");
            expect(within(dialog()).queryByRole("button", { name: /comparison/ })).not.toBeInTheDocument();
        }
    });
});
