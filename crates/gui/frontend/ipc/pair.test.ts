import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { cancelComparison, comparePair, probeMedia } from "./pair";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as Mock;

beforeEach(() => {
    mockedInvoke.mockReset();
});

describe("probeMedia", () => {
    it("sends the path and keeps every value", async () => {
        const info = {
            path: "/a.jpg",
            type: "image",
            width: 4032,
            height: 3024,
            size: 4_800_000,
            duration: 1.5,
            created: "2025-07-14T18:41:00Z",
            modified: "2025-07-15T09:00:00Z",
            format: "JPEG",
            colorProfile: "Display P3",
            frameRate: 29.97,
        };
        mockedInvoke.mockResolvedValue(info);

        await expect(probeMedia("/a.jpg")).resolves.toEqual(info);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("probe_media", { path: "/a.jpg" });
    });

    it("leaves out every null value", async () => {
        const absent = JSON.parse("null");
        mockedInvoke.mockResolvedValue({
            path: "/b.png",
            type: "image",
            width: 1,
            height: 2,
            size: 3,
            duration: absent,
            created: absent,
            modified: absent,
            format: absent,
            colorProfile: absent,
            frameRate: absent,
        });

        const info = await probeMedia("/b.png");

        expect(info).toStrictEqual({ path: "/b.png", type: "image", width: 1, height: 2, size: 3 });
    });

    it("rejects with a load failure", async () => {
        mockedInvoke.mockRejectedValue({ kind: "load", path: "/missing.png", message: "failed to read" });

        await expect(probeMedia("/missing.png")).rejects.toEqual({
            kind: "load",
            path: "/missing.png",
            message: "failed to read",
        });
    });
});

describe("comparePair", () => {
    it("sends both paths and resolves to the similarity", async () => {
        mockedInvoke.mockResolvedValue(0.9487);

        await expect(comparePair("/a.jpg", "/b.jpg")).resolves.toBe(0.9487);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("compare_pair", { a: "/a.jpg", b: "/b.jpg" });
    });

    it.each([
        [{ kind: "cancelled" }],
        [{ kind: "load", path: "/b.mp4", message: "failed to load video /b.mp4" }],
        [{ kind: "mismatch", message: "cannot compare image /a.png with video /b.mp4" }],
        [{ kind: "task", message: "the comparison task did not finish" }],
    ])("rejects with the %o failure", async (failure) => {
        mockedInvoke.mockRejectedValue(failure);

        await expect(comparePair("/a", "/b")).rejects.toEqual(failure);
    });

    it("turns any other rejection into a task failure", async () => {
        mockedInvoke.mockRejectedValue("command compare_pair not found");

        await expect(comparePair("/a", "/b")).rejects.toEqual({
            kind: "task",
            message: "command compare_pair not found",
        });
    });

    it("keeps only the fields of a failure's kind", async () => {
        mockedInvoke.mockRejectedValue({ kind: "cancelled", message: "extra" });

        await expect(comparePair("/a", "/b")).rejects.toEqual({ kind: "cancelled" });
    });
});

describe("cancelComparison", () => {
    it("calls the command with no arguments", async () => {
        mockedInvoke.mockResolvedValue(JSON.parse("null"));

        await cancelComparison();

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("cancel_comparison");
    });
});
