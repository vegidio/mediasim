import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaType } from "@/ipc/formats";
import { cancelScan, type ScanMessage, type ScanResult, startScan } from "@/ipc/scan";
import type { SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));

const mockedStart = startScan as Mock;
const mockedCancel = cancelScan as Mock;

/** One scan as the Rust side would run it: the test sends its messages and settles it when it chooses. */
type Scan = {
    send: (message: ScanMessage) => void;
    resolve: (result: ScanResult) => void;
    reject: (failure: unknown) => void;
};

const scans: Scan[] = [];

const file = (name: string, type: MediaType = "image"): MediaFile => ({
    path: `/u/Holiday 2025/${name}`,
    name,
    type,
    size: 1,
    identity: name.padEnd(16, "0"),
});

const folder: SourceView = {
    path: "/u/Holiday 2025",
    name: "Holiday 2025",
    location: "~/Holiday 2025",
    kind: "folder",
    count: 4,
    size: 4,
    unreadable: false,
    pending: false,
};

const FILES = [file("a.jpg"), file("b.jpg"), file("c.mp4", "video"), file("d.jpg")];

const state = () => useScanStore.getState();

/** Lets the promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
    scans.length = 0;
    mockedStart
        .mockReset()
        .mockImplementation(
            (_request, onMessage: (message: ScanMessage) => void) =>
                new Promise((resolve, reject) => scans.push({ send: onMessage, resolve, reject })),
        );
    mockedCancel.mockReset().mockResolvedValue(undefined);
    useScreenStore.setState(useScreenStore.getInitialState(), true);
    useScreenStore.getState().show("gallery");
    useHomeStore.setState({ view: { revision: 1, sources: [folder], total: FILES.length } });
    useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    useGalleryStore.setState({
        listing: { status: "ready", revision: 1, files: FILES },
        threshold: 85,
        frameRotate: true,
        frameFlip: false,
    });
    useScanStore.setState(useScanStore.getInitialState(), true);
});

describe("starting a scan", () => {
    it("scans the included files with the threshold and options, and shows the scan screen", () => {
        useGalleryStore.setState({ filter: "images" });

        state().start();

        expect(mockedStart).toHaveBeenCalledExactlyOnceWith(
            {
                paths: ["/u/Holiday 2025/a.jpg", "/u/Holiday 2025/b.jpg", "/u/Holiday 2025/d.jpg"],
                threshold: 0.85,
                rotate: true,
                flip: false,
            },
            expect.any(Function),
        );
        expect(useScreenStore.getState().screen).toBe("scan");
        expect(state().status).toBe("running");
        expect(state().progress).toEqual({ done: 0, total: 3, skipped: 0 });
        expect(state().heading).toEqual({ count: 3, set: "Holiday 2025", kinds: "images", threshold: 85 });
    });

    it("leaves out removed files and adds added ones", () => {
        useGalleryStore.setState({
            filter: "images",
            overrides: new Set(["/u/Holiday 2025/b.jpg", "/u/Holiday 2025/c.mp4"]),
        });

        state().start();

        expect(mockedStart.mock.calls[0]?.[0].paths).toEqual([
            "/u/Holiday 2025/a.jpg",
            "/u/Holiday 2025/c.mp4",
            "/u/Holiday 2025/d.jpg",
        ]);
        expect(state().heading?.kinds).toBe("both");
    });

    it("does nothing while the gallery's files are being read", () => {
        useGalleryStore.setState({ listing: { status: "loading" } });

        state().start();

        expect(mockedStart).not.toHaveBeenCalled();
        expect(useScreenStore.getState().screen).toBe("gallery");
    });

    it("keeps the heading it started with when the threshold changes", () => {
        state().start();

        useGalleryStore.getState().setThreshold(60);

        expect(state().heading?.threshold).toBe(85);
    });
});

describe("progress", () => {
    it("follows the messages", () => {
        state().start();

        scans[0]?.send({ kind: "processing", path: "/u/Holiday 2025/a.jpg", display: "~/Holiday 2025/a.jpg" });
        scans[0]?.send({ kind: "progress", done: 1, total: 4, skipped: 0, etaSeconds: 3 });

        expect(state().current).toEqual({ path: "/u/Holiday 2025/a.jpg", display: "~/Holiday 2025/a.jpg" });
        expect(state().progress).toEqual({ done: 1, total: 4, skipped: 0, etaSeconds: 3 });
    });

    it("drops the messages of an earlier scan", () => {
        state().start();
        state().cancel();
        state().start();

        scans[0]?.send({ kind: "progress", done: 3, total: 4, skipped: 0 });

        expect(state().progress.done).toBe(0);
    });

    it("follows the scoring", () => {
        state().start();

        scans[0]?.send({ kind: "scoring", done: 2, total: 9 });

        expect(state().scoring).toEqual({ done: 2, total: 9 });
    });

    it("drops the scoring of an earlier scan", () => {
        state().start();
        state().cancel();
        state().start();

        scans[0]?.send({ kind: "scoring", done: 2, total: 9 });

        expect(state().scoring).toBeUndefined();
    });
});

describe("scan finishes", () => {
    it("keeps the result and shows the groups screen", async () => {
        state().start();
        const groupFile = (name: string) => ({
            path: `/u/Holiday 2025/${name}`,
            type: "image" as const,
            width: 1,
            height: 1,
            size: 1,
        });
        const result = {
            groups: [
                {
                    files: [groupFile("a.jpg"), groupFile("b.jpg")],
                    scores: [
                        [1, 0.9],
                        [0.9, 1],
                    ],
                },
            ],
            skipped: [],
        };

        scans[0]?.resolve(result);
        await settle();

        expect(state().status).toBe("done");
        expect(state().result).toEqual(result);
        expect(useScreenStore.getState().screen).toBe("groups");
    });

    it("shows the failure when the scan can't run", async () => {
        state().start();

        scans[0]?.reject({ kind: "task", message: "boom" });
        await settle();

        expect(state().status).toBe("failed");
        expect(useScreenStore.getState().screen).toBe("scan");
    });
});

describe("settings during a scan", () => {
    it("goes back to the running scan", () => {
        state().start();
        useScreenStore.getState().openSettings();

        scans[0]?.send({ kind: "progress", done: 2, total: 4, skipped: 0 });
        useScreenStore.getState().closeSettings();

        expect(useScreenStore.getState().screen).toBe("scan");
        expect(state().progress.done).toBe(2);
    });

    it("stays on Settings when the scan finishes, and goes back to the groups", async () => {
        state().start();
        useScreenStore.getState().openSettings();

        scans[0]?.resolve({ groups: [], skipped: [] });
        await settle();

        expect(useScreenStore.getState().screen).toBe("settings");
        useScreenStore.getState().closeSettings();
        expect(useScreenStore.getState().screen).toBe("groups");
    });
});

describe("cancelling a scan", () => {
    it("stops the scan and shows the gallery as it was", () => {
        useGalleryStore.setState({ filter: "videos", threshold: 72, overrides: new Set(["/u/Holiday 2025/c.mp4"]) });
        const gallery = useGalleryStore.getState();
        state().start();

        state().cancel();

        expect(mockedCancel).toHaveBeenCalledOnce();
        expect(useScreenStore.getState().screen).toBe("gallery");
        expect(state().status).toBe("idle");
        expect(useGalleryStore.getState()).toBe(gallery);
    });

    it("ignores the stopped scan's outcome", async () => {
        state().start();
        state().cancel();

        scans[0]?.resolve({ groups: [], skipped: [] });
        scans[0]?.reject({ kind: "cancelled" });
        await settle();

        expect(state().status).toBe("idle");
        expect(useScreenStore.getState().screen).toBe("gallery");
    });

    it("stops while the groups are scored, and never shows the groups screen", async () => {
        state().start();
        scans[0]?.send({ kind: "progress", done: 4, total: 4, skipped: 0 });
        scans[0]?.send({ kind: "scoring", done: 2, total: 9 });

        state().cancel();
        scans[0]?.reject({ kind: "cancelled" });
        await settle();

        expect(mockedCancel).toHaveBeenCalledOnce();
        expect(useScreenStore.getState().screen).toBe("gallery");
        expect(state().status).toBe("idle");
        expect(state().scoring).toBeUndefined();
        expect(state().result).toBeUndefined();
    });

    it("starts again from 0% when Compare is activated again", () => {
        state().start();
        scans[0]?.send({ kind: "progress", done: 2, total: 4, skipped: 0 });
        state().cancel();

        state().start();

        expect(mockedStart).toHaveBeenCalledTimes(2);
        expect(state().status).toBe("running");
        expect(state().progress).toEqual({ done: 0, total: 4, skipped: 0 });
        expect(state().current).toBeUndefined();
    });
});

describe("leaving the groups", () => {
    /** Runs a scan to the groups screen. */
    const finish = async () => {
        state().start();
        scans[0]?.send({ kind: "scoring", done: 0, total: 0 });
        scans[0]?.resolve({ groups: [], skipped: [] });
        await settle();
    };

    it("shows the gallery on Back, forgetting the result and the scoring", async () => {
        await finish();

        state().leave();

        expect(useScreenStore.getState().screen).toBe("gallery");
        expect(state().result).toBeUndefined();
        expect(state().scoring).toBeUndefined();
        expect(state().status).toBe("idle");
    });

    it("shows Home on New comparison, forgetting the result and the scoring", async () => {
        await finish();

        state().newComparison();

        expect(useScreenStore.getState().screen).toBe("home");
        expect(state().result).toBeUndefined();
        expect(state().scoring).toBeUndefined();
        expect(state().status).toBe("idle");
        expect(useHomeStore.getState().view.sources).toEqual([folder]);
    });
});
