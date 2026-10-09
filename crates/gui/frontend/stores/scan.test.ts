import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaType } from "@/ipc/formats";
import { cancelScan, type ScanMessage, type ScanResult, startScan } from "@/ipc/scan";
import type { SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { deleteMedia, restoreMedia, trashMedia } from "@/ipc/trash";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn(), restoreMedia: vi.fn() }));

const mockedStart = startScan as Mock;
const mockedCancel = cancelScan as Mock;
const mockedTrash = trashMedia as Mock;
const mockedDelete = deleteMedia as Mock;
const mockedRestore = restoreMedia as Mock;

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
    mockedTrash.mockReset();
    mockedDelete.mockReset();
    mockedRestore.mockReset();
    useSettingsStore.setState(SETTINGS_DEFAULTS);
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

describe("marks", () => {
    /** Runs a scan to the groups screen. */
    const finish = async () => {
        state().start();
        scans.at(-1)?.resolve({ groups: [], skipped: [] });
        await settle();
    };

    it("start empty", () => {
        expect(state().marks.size).toBe(0);
    });

    it("toggle a file on, then off, in a new set each time", () => {
        const before = state().marks;

        state().toggleMark("/a.jpg");
        const marked = state().marks;
        state().toggleMark("/a.jpg");

        expect(marked).not.toBe(before);
        expect([...marked]).toEqual(["/a.jpg"]);
        expect(state().marks).not.toBe(marked);
        expect(state().marks.size).toBe(0);
    });

    it("are replaced by setMarks", () => {
        state().setMarks(["/a.jpg", "/b.jpg"]);

        state().setMarks(["/c.jpg"]);

        expect([...state().marks]).toEqual(["/c.jpg"]);
    });

    it("are emptied by clearMarks", () => {
        state().setMarks(["/a.jpg", "/b.jpg"]);

        state().clearMarks();

        expect(state().marks.size).toBe(0);
    });

    it.each([
        ["Back", () => state().leave()],
        ["New comparison", () => state().newComparison()],
        ["a new scan", () => state().start()],
    ])("are forgotten on %s", async (_, end) => {
        await finish();
        state().setMarks(["/u/Holiday 2025/a.jpg"]);

        end();

        expect(state().marks.size).toBe(0);
    });

    it("are kept across Settings", async () => {
        await finish();
        state().setMarks(["/u/Holiday 2025/a.jpg"]);

        useScreenStore.getState().openSettings();
        useScreenStore.getState().closeSettings();

        expect(useScreenStore.getState().screen).toBe("groups");
        expect([...state().marks]).toEqual(["/u/Holiday 2025/a.jpg"]);
    });
});

describe("removing marked files", () => {
    const path = (name: string) => `/u/Holiday 2025/${name}`;
    const groupFile = (name: string) => ({ path: path(name), type: "image" as const, width: 1, height: 1, size: 1 });
    const id = (name: string) => name.padEnd(16, "0");
    const listed = () => {
        const { listing } = useGalleryStore.getState();
        return listing.status === "ready" ? listing.files : [];
    };

    /** Runs a scan of every file to groups `a.jpg, b.jpg` and `c.mp4, d.jpg`, and marks `b.jpg` and `d.jpg`. */
    const finish = async () => {
        state().start();
        scans.at(-1)?.resolve({
            groups: [
                { files: [groupFile("a.jpg"), groupFile("b.jpg")], scores: [] },
                { files: [groupFile("c.mp4"), groupFile("d.jpg")], scores: [] },
            ],
            skipped: [],
        });
        await settle();
        state().setMarks([path("b.jpg"), path("d.jpg")]);
    };

    /** A promise the test settles when it chooses. */
    const deferred = <T>() => {
        let resolve: (value: T) => void = () => {};
        const promise = new Promise<T>((r) => {
            resolve = r;
        });
        return { promise, resolve };
    };

    describe("requestDeletion", () => {
        it("asks to confirm with confirmation on, in the mode in force, without removing anything", async () => {
            await finish();

            await state().requestDeletion();

            expect(state().deletion).toEqual({ status: "confirming", mode: "trash" });
            expect(mockedTrash).not.toHaveBeenCalled();
        });

        it("removes at once with confirmation off", async () => {
            useSettingsStore.setState({ confirmDeletion: false });
            await finish();
            mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);

            await state().requestDeletion();

            expect(mockedTrash).toHaveBeenCalledExactlyOnceWith([id("b.jpg"), id("d.jpg")]);
            expect(state().deletion).toEqual({ status: "idle" });
        });

        it("reads 'removing' without confirmation while it runs", async () => {
            useSettingsStore.setState({ confirmDeletion: false, deletionMode: "permanent" });
            await finish();
            const pending = deferred<unknown[]>();
            mockedDelete.mockReturnValue(pending.promise);

            const run = state().requestDeletion();

            expect(state().deletion).toEqual({ status: "removing", mode: "permanent", confirmed: false });
            pending.resolve([{ status: "deleted" }, { status: "deleted" }]);
            await run;
        });

        it("does nothing with nothing marked", async () => {
            await finish();
            state().clearMarks();

            await state().requestDeletion();

            expect(state().deletion).toEqual({ status: "idle" });
        });

        it("keeps the mode it was asked in when Settings changes before confirming", async () => {
            await finish();
            await state().requestDeletion();
            useSettingsStore.setState({ deletionMode: "permanent" });
            mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);

            await state().removeMarked();

            expect(mockedTrash).toHaveBeenCalledOnce();
            expect(mockedDelete).not.toHaveBeenCalled();
        });

        it("doesn't start another while one runs", async () => {
            useSettingsStore.setState({ confirmDeletion: false });
            await finish();
            const pending = deferred<unknown[]>();
            mockedTrash.mockReturnValue(pending.promise);

            const run = state().requestDeletion();
            await state().requestDeletion();
            pending.resolve([{ status: "trashed" }, { status: "trashed" }]);
            await run;

            expect(mockedTrash).toHaveBeenCalledOnce();
        });
    });

    it("closes the confirmation on cancel, keeping the marks", async () => {
        await finish();
        await state().requestDeletion();

        state().cancelDeletion();

        expect(state().deletion).toEqual({ status: "idle" });
        expect([...state().marks]).toEqual([path("b.jpg"), path("d.jpg")]);
    });

    it.each([
        ["trash", mockedTrash, { status: "trashed" }],
        ["permanent", mockedDelete, { status: "deleted" }],
    ] as const)("calls the right command in %s mode", async (mode, command, outcome) => {
        useSettingsStore.setState({ deletionMode: mode });
        await finish();
        command.mockResolvedValue([outcome, outcome]);

        await state().requestDeletion();
        await state().removeMarked();

        expect(command).toHaveBeenCalledExactlyOnceWith([id("b.jpg"), id("d.jpg")]);
        expect(state().gone).toEqual(
            new Map([
                [path("b.jpg"), mode],
                [path("d.jpg"), mode],
            ]),
        );
    });

    it("sends only the marked files still shown, in group order", async () => {
        await finish();
        state().setMarks([path("d.jpg"), path("b.jpg"), "/elsewhere/x.jpg"]);
        mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);

        await state().requestDeletion();
        await state().removeMarked();

        expect(mockedTrash).toHaveBeenCalledExactlyOnceWith([id("b.jpg"), id("d.jpg")]);
    });

    it("unmarks and records the removed file, keeps a failed one marked, and withdraws the removed one", async () => {
        await finish();
        mockedTrash.mockResolvedValue([
            { status: "trashed" },
            { status: "failed", reason: "changed", message: "changed" },
        ]);

        await state().requestDeletion();
        await state().removeMarked();

        expect(state().gone).toEqual(new Map([[path("b.jpg"), "trash"]]));
        expect([...state().marks]).toEqual([path("d.jpg")]);
        expect(state().notice).toEqual({
            action: "trash",
            done: [path("b.jpg")],
            failed: [{ path: path("d.jpg"), message: "changed" }],
        });
        expect(listed().map((file) => file.name)).toEqual(["a.jpg", "c.mp4", "d.jpg"]);
    });

    it("fails every file when the command can't run", async () => {
        await finish();
        mockedTrash.mockRejectedValue("command trash_media not found");

        await state().requestDeletion();
        await state().removeMarked();

        expect(state().gone.size).toBe(0);
        expect(state().marks.size).toBe(2);
        expect(state().notice?.failed).toEqual([
            { path: path("b.jpg"), message: "command trash_media not found" },
            { path: path("d.jpg"), message: "command trash_media not found" },
        ]);
    });

    it("drops a result that arrives after Back", async () => {
        await finish();
        const pending = deferred<unknown[]>();
        mockedTrash.mockReturnValue(pending.promise);
        await state().requestDeletion();
        const run = state().removeMarked();

        state().leave();
        pending.resolve([{ status: "trashed" }, { status: "trashed" }]);
        await run;

        expect(state().gone.size).toBe(0);
        expect(state().notice).toBeUndefined();
        expect(listed()).toHaveLength(4);
    });

    it.each([
        ["a new scan", () => state().start()],
        ["New comparison", () => state().newComparison()],
    ])("forgets what was removed and the notice on %s", async (_, end) => {
        await finish();
        mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);
        await state().requestDeletion();
        await state().removeMarked();

        end();

        expect(state().gone.size).toBe(0);
        expect(state().notice).toBeUndefined();
        expect(state().deletion).toEqual({ status: "idle" });
    });

    it("closes the notice on dismiss", async () => {
        await finish();
        mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);
        await state().requestDeletion();
        await state().removeMarked();

        state().dismissNotice();

        expect(state().notice).toBeUndefined();
        expect(state().gone.size).toBe(2);
    });

    describe("restore", () => {
        /** Moves `b.jpg` and `d.jpg` to the Trash. */
        const trashBoth = async () => {
            await finish();
            mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);
            await state().requestDeletion();
            await state().removeMarked();
        };

        it("brings the files back marked, with their new identities in the files and the gallery", async () => {
            await trashBoth();
            mockedRestore.mockResolvedValue([
                { status: "restored", identity: "b-new" },
                { status: "restored", identity: "d-new" },
            ]);

            await state().restore([path("b.jpg"), path("d.jpg")]);

            expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([id("b.jpg"), id("d.jpg")]);
            expect(state().gone.size).toBe(0);
            expect([...state().marks].sort()).toEqual([path("b.jpg"), path("d.jpg")]);
            expect(state().files.map((file) => file.identity)).toEqual([id("a.jpg"), "b-new", id("c.mp4"), "d-new"]);
            expect(listed().map((file) => file.identity)).toEqual([id("a.jpg"), "b-new", id("c.mp4"), "d-new"]);
            expect(state().notice).toEqual({ action: "restore", done: [path("b.jpg"), path("d.jpg")], failed: [] });
        });

        it("never sends a deleted file", async () => {
            useSettingsStore.setState({ deletionMode: "permanent" });
            await finish();
            mockedDelete.mockResolvedValue([{ status: "deleted" }, { status: "deleted" }]);
            await state().requestDeletion();
            await state().removeMarked();

            await state().restore([path("b.jpg"), path("d.jpg")]);

            expect(mockedRestore).not.toHaveBeenCalled();
            expect(state().gone.size).toBe(2);
        });

        it("keeps a file that couldn't be restored gone, and names it", async () => {
            await trashBoth();
            mockedRestore.mockResolvedValue([
                { status: "restored", identity: "b-new" },
                { status: "failed", reason: "occupied", message: "path taken" },
            ]);

            await state().restore([path("b.jpg"), path("d.jpg")]);

            expect(state().gone).toEqual(new Map([[path("d.jpg"), "trash"]]));
            expect([...state().marks]).toEqual([path("b.jpg")]);
            expect(state().notice?.failed).toEqual([{ path: path("d.jpg"), message: "path taken" }]);
            expect(listed().map((file) => file.name)).toEqual(["a.jpg", "b.jpg", "c.mp4"]);
        });

        it("starts no removal while restoring", async () => {
            await trashBoth();
            state().setMarks([path("a.jpg")]);
            const pending = deferred<unknown[]>();
            mockedRestore.mockReturnValue(pending.promise);

            const run = state().restore([path("b.jpg")]);
            expect(state().deletion).toEqual({ status: "restoring" });
            await state().requestDeletion();

            expect(state().deletion).toEqual({ status: "restoring" });
            pending.resolve([{ status: "restored", identity: "b-new" }]);
            await run;
            expect(state().deletion).toEqual({ status: "idle" });
        });
    });
});
