import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import { startScan } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { GroupsScreen, groupsHeading } from "./GroupsScreen";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));

const mockedStart = startScan as Mock;

const skipped = (path: string) => ({ path, message: `failed to read ${path}` });

/** Show the groups screen's state as a scan that found `groups` groups and skipped `unread` files leaves it. */
const finished = (groups: number, unread: number) =>
    useScanStore.setState({
        status: "done",
        result: {
            groups: Array.from({ length: groups }, (_, i) => [`/p/${i}a.jpg`, `/p/${i}b.jpg`]),
            skipped: Array.from({ length: unread }, (_, i) => skipped(`/p/bad${i}.jpg`)),
        },
    });

beforeEach(() => {
    mockedStart.mockReset();
    useScanStore.setState(useScanStore.getInitialState(), true);
    useScreenStore.setState(useScreenStore.getInitialState(), true);
});

describe("groupsHeading", () => {
    it("reads the plural, the singular and none", () => {
        expect(groupsHeading(3)).toBe("3 similar groups found");
        expect(groupsHeading(1)).toBe("1 similar group found");
        expect(groupsHeading(0)).toBe("No similar files found");
    });
});

describe("Groups screen", () => {
    it("reads the groups found and the files that couldn't be read", () => {
        finished(3, 2);
        render(<GroupsScreen />);

        expect(screen.getByRole("heading", { level: 1, name: "3 similar groups found" })).toBeInTheDocument();
        expect(screen.getByText("2 files couldn't be read")).toBeInTheDocument();
    });

    it("reads one group and one unreadable file in the singular", () => {
        finished(1, 1);
        render(<GroupsScreen />);

        expect(screen.getByRole("heading", { level: 1, name: "1 similar group found" })).toBeInTheDocument();
        expect(screen.getByText("1 file couldn't be read")).toBeInTheDocument();
    });

    it("reads that nothing similar was found, with no line about unreadable files", () => {
        finished(0, 0);
        render(<GroupsScreen />);

        expect(screen.getByRole("heading", { level: 1, name: "No similar files found" })).toBeInTheDocument();
        expect(screen.queryByText(/couldn't be read/)).not.toBeInTheDocument();
    });

    it("goes Back to the gallery as it was, with focus on Compare", async () => {
        const files: MediaFile[] = ["a", "b", "c"].map((name) => ({
            path: `/p/${name}.jpg`,
            name,
            type: "image",
            size: 1,
            identity: `id-${name}`,
        }));
        useHomeStore.setState({ view: { revision: 1, sources: [], total: files.length }, sources: [], rescans: 0 });
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useGalleryStore.setState({ listing: { status: "ready", revision: 1, files }, threshold: 91 });
        const gallery = useGalleryStore.getState();
        render(<App />);
        act(() => useScreenStore.getState().show("groups"));
        act(() => finished(2, 0));

        fireEvent.click(screen.getByRole("button", { name: "Back" }));

        expect(screen.getByRole("tablist", { name: "Filter media" })).toBeInTheDocument();
        expect(screen.getByText("91%")).toBeInTheDocument();
        expect(useGalleryStore.getState()).toBe(gallery);
        await waitFor(() => expect(screen.getByRole("button", { name: "Compare 3 files" })).toHaveFocus());
    });

    it("is where a finished scan leads, by itself", async () => {
        let finish: (result: unknown) => void = () => {};
        mockedStart.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const files: MediaFile[] = ["a", "b"].map((name) => ({
            path: `/p/${name}.jpg`,
            name,
            type: "image",
            size: 1,
            identity: `id-${name}`,
        }));
        useGalleryStore.setState({ listing: { status: "ready", revision: 1, files } });
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));
        act(() => useScanStore.getState().start());
        expect(screen.getByRole("heading", { level: 1, name: "Comparing 2 files" })).toBeInTheDocument();

        await act(async () => finish({ groups: [["/p/a.jpg", "/p/b.jpg"]], skipped: [] }));

        expect(screen.getByRole("heading", { level: 1, name: "1 similar group found" })).toBeInTheDocument();
    });
});
