import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { cancelScan, type ScanMessage, startScan } from "./scan";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
    // Holds the handler it is built with, as the real one does, so a test can play the Rust side.
    Channel: class {
        constructor(readonly onmessage: (message: unknown) => void) {}
    },
}));

const mockedInvoke = invoke as Mock;

const request = { paths: ["/a.png", "/b.png"], threshold: 0.85, rotate: true, flip: false };

type Sent = { onEvent: { onmessage: (message: unknown) => void } };

/** The channel `start_scan` was called with. */
const sent = () => {
    const [[, args]] = mockedInvoke.mock.calls as [[string, Sent]];
    return args.onEvent;
};

beforeEach(() => {
    mockedInvoke.mockReset();
});

describe("startScan", () => {
    it("sends the request with a channel and resolves to the result", async () => {
        const file = (path: string) => ({
            path,
            type: "image",
            width: 640,
            height: 480,
            size: 1000,
            duration: JSON.parse("null"),
            created: "2025-01-02T03:04:05Z",
            modified: "2025-01-02T03:04:05Z",
        });
        const result = {
            groups: [
                {
                    files: [file("/a.png"), file("/b.png")],
                },
            ],
            skipped: [{ path: "/c.png", message: "boom" }],
        };
        mockedInvoke.mockResolvedValue(result);

        const { duration: _, ...read } = file("/a.png");
        await expect(startScan(request, () => {})).resolves.toStrictEqual({
            groups: [
                {
                    files: [read, { ...read, path: "/b.png" }],
                },
            ],
            skipped: [{ path: "/c.png", message: "boom" }],
        });
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("start_scan", {
            ...request,
            onEvent: expect.anything(),
        });
    });

    it("leaves out a grouped file's null metadata", async () => {
        const nothing = JSON.parse("null");
        const file = { path: "/v.mp4", type: "video", width: 1, height: 1, size: 1 };
        mockedInvoke.mockResolvedValue({
            groups: [
                {
                    files: [
                        { ...file, duration: nothing, created: nothing, modified: nothing },
                        { ...file, duration: 42.5, created: nothing, modified: nothing },
                    ],
                },
            ],
            skipped: [],
        });

        const result = await startScan(request, () => {});

        expect(result.groups[0]?.files).toStrictEqual([file, { ...file, duration: 42.5 }]);
    });

    it("delivers each message to the callback", async () => {
        mockedInvoke.mockResolvedValue({ groups: [], skipped: [] });
        const messages: ScanMessage[] = [];

        await startScan(request, (message) => messages.push(message));
        sent().onmessage({ kind: "processing", path: "/u/a.png", display: "~/a.png" });
        sent().onmessage({ kind: "progress", done: 0, total: 2, skipped: 0 });
        sent().onmessage({ kind: "progress", done: 1, total: 2, skipped: 1, etaSeconds: 4.5 });

        expect(messages).toStrictEqual([
            { kind: "processing", path: "/u/a.png", display: "~/a.png" },
            { kind: "progress", done: 0, total: 2, skipped: 0 },
            { kind: "progress", done: 1, total: 2, skipped: 1, etaSeconds: 4.5 },
        ]);
    });

    it("rejects as cancelled", async () => {
        mockedInvoke.mockRejectedValue({ kind: "cancelled" });

        await expect(startScan(request, () => {})).rejects.toStrictEqual({ kind: "cancelled" });
    });

    it("rejects with a task failure", async () => {
        mockedInvoke.mockRejectedValue({ kind: "task", message: "the threshold must be between 0 and 1" });

        await expect(startScan(request, () => {})).rejects.toStrictEqual({
            kind: "task",
            message: "the threshold must be between 0 and 1",
        });
    });

    it("turns any other rejection into a task failure", async () => {
        mockedInvoke.mockRejectedValue("command start_scan not found");

        await expect(startScan(request, () => {})).rejects.toStrictEqual({
            kind: "task",
            message: "command start_scan not found",
        });
    });
});

describe("cancelScan", () => {
    it("calls the command with no arguments", async () => {
        mockedInvoke.mockResolvedValue(JSON.parse("null"));

        await cancelScan();

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("cancel_scan");
    });
});
