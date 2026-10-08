import { create } from "zustand";
import { identity, includedFiles } from "@/features/gallery/derive";
import { cancelScan, type ScanFailure, type ScanResult, startScan } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { type GalleryFilter, useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScreenStore } from "@/stores/screen";

/** Where the scan is: none, running, ended without a result, or finished with one. */
export type ScanStatus = "idle" | "running" | "failed" | "done";

/** How far the scan has got, as it last reported. */
export type ScanProgress = {
    /** The files done, skipped ones included. */
    done: number;
    total: number;
    /** The files that couldn't be read. */
    skipped: number;
    /** The estimated time left, in seconds, once there is one. */
    etaSeconds?: number;
};

/** What the scan screen's heading describes, as it was when the scan started. */
export type ScanHeading = {
    /** The number of files scanned. */
    count: number;
    /** The gallery's identity title: the folder's name, or "N files". */
    set: string;
    /** Which kinds the scanned files include: only images, only videos, or both. */
    kinds: GalleryFilter;
    /** The match threshold, in whole percent. */
    threshold: number;
};

/** The file the scan last reported it is processing. */
export type ScanCurrent = { path: string; display: string };

/** State of the comparison of a set's files, from Compare to the groups. */
type ScanStore = {
    status: ScanStatus;
    /** Numbers each scan, so the messages and the outcome of one that was left are ignored. */
    run: number;
    heading?: ScanHeading;
    /** The files scanned, as the gallery read them, in its order. */
    files: readonly MediaFile[];
    progress: ScanProgress;
    current?: ScanCurrent;
    /** The groups and the unreadable files, once the scan is done. */
    result?: ScanResult;
    /**
     * Scans the files the gallery's Compare button includes, under its threshold and comparison options, and shows the
     * scan screen. Once the scan is done, shows the groups screen in its place, or makes Settings return to it.
     */
    start: () => void;
    /** Stops the scan and shows the gallery as it was. */
    cancel: () => void;
    /** Forgets the scan and shows the gallery as it was. */
    leave: () => void;
};

/** The kinds `files` include. */
const kindsOf = (files: readonly MediaFile[]): GalleryFilter => {
    const images = files.some((file) => file.type === "image");
    const videos = files.some((file) => file.type === "video");
    return images && videos ? "both" : videos ? "videos" : "images";
};

const IDLE: Pick<ScanStore, "status" | "files" | "progress"> = {
    status: "idle",
    files: [],
    progress: { done: 0, total: 0, skipped: 0 },
};

/** `state` without what belongs to one scan: its heading, current file and result. */
const withoutRun = ({ heading: _heading, current: _current, result: _result, ...rest }: ScanStore) => rest;

export const useScanStore = create<ScanStore>()((set, get) => {
    /** Applies `update` only while scan `run` is still the current one. */
    const forRun = (run: number, update: () => void) => {
        if (get().run === run) update();
    };

    return {
        ...IDLE,
        run: 0,

        start: () => {
            const { listing, filter, overrides, threshold, frameRotate, frameFlip } = useGalleryStore.getState();
            if (listing.status !== "ready") return;

            const files = includedFiles(listing.files, filter, overrides);
            const { sources, total } = useHomeStore.getState().view;
            const heading: ScanHeading = {
                count: files.length,
                set: identity(sources, total, listing.files).title,
                kinds: kindsOf(files),
                threshold,
            };
            const run = get().run + 1;

            set(
                {
                    ...withoutRun(get()),
                    status: "running",
                    run,
                    heading,
                    files,
                    progress: { done: 0, total: files.length, skipped: 0 },
                },
                true,
            );
            useScreenStore.getState().show("scan");

            const request = { paths: files.map((file) => file.path), threshold: threshold / 100 };
            startScan({ ...request, rotate: frameRotate, flip: frameFlip }, (message) =>
                forRun(run, () => {
                    if (message.kind === "processing") {
                        set({ current: { path: message.path, display: message.display } });
                    } else {
                        const { kind: _, ...progress } = message;
                        set({ progress });
                    }
                }),
            ).then(
                (result) =>
                    forRun(run, () => {
                        set({ status: "done", result });
                        useScreenStore.getState().redirect("scan", "groups");
                    }),
                (failure: ScanFailure) =>
                    forRun(run, () => {
                        // A cancelled scan was left on purpose; anything else can't run at all.
                        if (failure.kind === "cancelled") return;
                        console.error("the comparison couldn't finish", failure.message);
                        set({ status: "failed" });
                    }),
            );
        },

        cancel: () => {
            cancelScan().catch((error: unknown) => console.error("could not cancel the comparison", error));
            get().leave();
        },

        leave: () => {
            const state = get();
            set({ ...withoutRun(state), ...IDLE, run: state.run + 1 }, true);
            useScreenStore.getState().show("gallery");
        },
    };
});
