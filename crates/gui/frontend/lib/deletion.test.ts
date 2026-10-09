import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { deleteMedia, restoreMedia, trashMedia } from "@/ipc/trash";
import { deletionLabel, removeFiles, restoreFiles } from "./deletion";

vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn(), restoreMedia: vi.fn() }));

const mockedTrash = trashMedia as Mock;
const mockedDelete = deleteMedia as Mock;
const mockedRestore = restoreMedia as Mock;

describe("deletionLabel", () => {
    it.each([
        ["trash", true, 2, "Move 2 to Trash…"],
        ["trash", false, 2, "Move 2 to Trash"],
        ["permanent", false, 3, "Delete 3 permanently"],
        ["permanent", true, 3, "Delete 3 permanently…"],
    ] as const)("reads, in %s mode with confirm %s and %i files, %s", (mode, confirm, count, label) => {
        expect(deletionLabel(mode, confirm, count)).toBe(label);
    });
});

const items = [
    { key: "/media/c.jpg", identity: "id-c" },
    { key: "/media/a.jpg", identity: "id-a" },
    { key: "/media/b.jpg", identity: "id-b" },
];

describe("removeFiles", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("moves to the Trash, keeping the order of string keys", async () => {
        mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }, { status: "trashed" }]);

        const settled = await removeFiles("trash", items);

        expect(mockedTrash).toHaveBeenCalledExactlyOnceWith(["id-c", "id-a", "id-b"]);
        expect(mockedDelete).not.toHaveBeenCalled();
        expect(settled).toEqual({ done: ["/media/c.jpg", "/media/a.jpg", "/media/b.jpg"], failed: [] });
    });

    it("splits a mixed deletion into done and failed", async () => {
        mockedDelete.mockResolvedValue([
            { status: "deleted" },
            { status: "failed", reason: "changed", message: "it has changed" },
            { status: "deleted" },
        ]);

        const settled = await removeFiles("permanent", items);

        expect(mockedDelete).toHaveBeenCalledExactlyOnceWith(["id-c", "id-a", "id-b"]);
        expect(mockedTrash).not.toHaveBeenCalled();
        expect(settled).toEqual({
            done: ["/media/c.jpg", "/media/b.jpg"],
            failed: [{ key: "/media/a.jpg", message: "it has changed" }],
        });
    });

    it("fails every file with the error's text when the call is rejected", async () => {
        mockedTrash.mockRejectedValue("no Trash");

        const settled = await removeFiles("trash", items);

        expect(settled).toEqual({
            done: [],
            failed: items.map(({ key }) => ({ key, message: "no Trash" })),
        });
    });

    it("fails a file the reply has no outcome for", async () => {
        mockedTrash.mockResolvedValue([{ status: "trashed" }]);

        const settled = await removeFiles("trash", items);

        expect(settled).toEqual({
            done: ["/media/c.jpg"],
            failed: [
                { key: "/media/a.jpg", message: "no result came back" },
                { key: "/media/b.jpg", message: "no result came back" },
            ],
        });
    });
});

describe("restoreFiles", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns each restored file's new identity, and the failures in order", async () => {
        mockedRestore.mockResolvedValue([
            { status: "restored", identity: "id-c2" },
            { status: "failed", reason: "occupied", message: "a file with its name is already in its folder" },
            { status: "restored", identity: "id-b2" },
        ]);

        const settled = await restoreFiles(items);

        expect(mockedRestore).toHaveBeenCalledExactlyOnceWith(["id-c", "id-a", "id-b"]);
        expect(settled.done).toEqual(["/media/c.jpg", "/media/b.jpg"]);
        expect(settled.failed).toEqual([
            { key: "/media/a.jpg", message: "a file with its name is already in its folder" },
        ]);
        expect([...settled.identities]).toEqual([
            ["/media/c.jpg", "id-c2"],
            ["/media/b.jpg", "id-b2"],
        ]);
    });

    it("fails every file with the error's text when the call is rejected", async () => {
        mockedRestore.mockRejectedValue(new Error("the Trash can't be read"));

        const settled = await restoreFiles(items);

        expect(settled.done).toEqual([]);
        expect(settled.failed).toEqual(items.map(({ key }) => ({ key, message: "Error: the Trash can't be read" })));
        expect(settled.identities.size).toBe(0);
    });

    it("fails a file the reply has no outcome for", async () => {
        mockedRestore.mockResolvedValue([]);

        const settled = await restoreFiles(items.slice(0, 1));

        expect(settled.failed).toEqual([{ key: "/media/c.jpg", message: "no result came back" }]);
    });
});
