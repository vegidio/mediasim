import { create } from "zustand";
import { identity, includedFiles } from "@/features/gallery/derive";
import { markedFiles, visibleGroups } from "@/features/groups/marks";
import { cancelScan, type ScanFailure, type ScanResult, startScan } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { type Deletion, deletionActions, type Notice, removeFiles, restoreFiles } from "@/lib/deletion";
import { type GalleryFilter, useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScreenStore } from "@/stores/screen";
import type { DeletionMode } from "@/stores/settings";

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

/** The result of the last move to the Trash, permanent deletion or restore from the groups screen, by path. */
export type ScanNotice = Notice<string>;

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
    /** The paths of the files marked for deletion on the groups screen. */
    marks: ReadonlySet<string>;
    /** How each file removed from the groups screen, and not restored, left, by path. */
    gone: ReadonlyMap<string, DeletionMode>;
    deletion: Deletion;
    /** The result of the last removal or restore, until it is dismissed or the scan is forgotten. */
    notice?: ScanNotice;
    /**
     * Scans the files the gallery's Compare button includes, under its threshold and comparison options, and shows the
     * scan screen. Once the scan is done, shows the groups screen in its place, or makes Settings return to it.
     */
    start: () => void;
    /** Stops the scan and shows the gallery as it was. */
    cancel: () => void;
    /** Forgets the scan and shows the gallery as it was. */
    leave: () => void;
    /** Forgets the scan and shows the Home screen, with the set unchanged. */
    newComparison: () => void;
    /** Marks the file at `path`, or unmarks it when it is marked. */
    toggleMark: (path: string) => void;
    /** Marks exactly the files at `paths`, unmarking every other. */
    setMarks: (paths: Iterable<string>) => void;
    /** Unmarks every file. */
    clearMarks: () => void;
    /**
     * Start removing the marked files still shown, in the deletion mode in force: ask to confirm first while the
     * settings say so, or remove them at once. Does nothing while none is marked or another deletion or restore is
     * under way.
     */
    requestDeletion: () => Promise<void>;
    /** Close the confirmation without removing anything. */
    cancelDeletion: () => void;
    /** Remove the marked files in the confirming mode, once confirmed, and record the result. */
    removeMarked: () => Promise<void>;
    /** Put the files of `paths` that are in the Trash back where they were, marked, and record the result. */
    restore: (paths: string[]) => Promise<void>;
    /** Close the notice. */
    dismissNotice: () => void;
};

/** The kinds `files` include. */
const kindsOf = (files: readonly MediaFile[]): GalleryFilter => {
    const images = files.some((file) => file.type === "image");
    const videos = files.some((file) => file.type === "video");
    return images && videos ? "both" : videos ? "videos" : "images";
};

const IDLE: Pick<ScanStore, "status" | "files" | "progress" | "marks" | "gone" | "deletion"> = {
    status: "idle",
    files: [],
    progress: { done: 0, total: 0, skipped: 0 },
    marks: new Set(),
    gone: new Map(),
    deletion: { status: "idle" },
};

/** `state` without what belongs to one scan: its heading, current file, result and notice. */
const withoutRun = ({ heading: _heading, current: _current, result: _result, notice: _notice, ...rest }: ScanStore) =>
    rest;

/** The paths of the files of the groups still shown that are marked, in the groups' order and each group's order. */
const markedShown = ({ result, gone, marks }: ScanStore): string[] =>
    result ? markedFiles(visibleGroups(result.groups, gone), marks).map((file) => file.path) : [];

const mediaByFiles = new WeakMap<readonly MediaFile[], ReadonlyMap<string, MediaFile>>();

/** The scanned files by path, built once for each list of files. */
export const selectMedia = ({ files }: Pick<ScanStore, "files">): ReadonlyMap<string, MediaFile> => {
    let media = mediaByFiles.get(files);
    if (!media) {
        media = new Map(files.map((file) => [file.path, file]));
        mediaByFiles.set(files, media);
    }
    return media;
};

/** `paths` paired with the identity each file is admitted as, leaving out any path not scanned. */
const removable = (state: Pick<ScanStore, "files">, paths: readonly string[]) => {
    const media = selectMedia(state);
    return paths.flatMap((path) => {
        const file = media.get(path);
        return file ? [{ key: path, identity: file.identity }] : [];
    });
};

export const useScanStore = create<ScanStore>()((set, get) => {
    /** Applies `update` only while scan `run` is still the current one. */
    const forRun = (run: number, update: () => void) => {
        if (get().run === run) update();
    };

    /** Forgets the scan, so its late messages and outcome are ignored. */
    const reset = () => {
        const state = get();
        set({ ...withoutRun(state), ...IDLE, run: state.run + 1 }, true);
    };

    /** Removes the marked files still shown in `mode`, and records how each went. */
    const remove = async (mode: DeletionMode, confirmed: boolean) => {
        const state = get();
        const { run } = state;
        const items = removable(state, markedShown(state));
        set({ deletion: { status: "removing", mode, confirmed } });

        const settled = await removeFiles(mode, items);
        forRun(run, () => {
            const notice: ScanNotice = { action: mode, ...settled };
            set((state) => {
                const gone = new Map(state.gone);
                const marks = new Set(state.marks);
                for (const path of notice.done) {
                    gone.set(path, mode);
                    marks.delete(path);
                }
                return { gone, marks, deletion: IDLE.deletion, notice };
            });
            useGalleryStore.getState().withdraw(notice.done);
        });
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
                    ...IDLE,
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
            reset();
            useScreenStore.getState().show("gallery");
        },

        newComparison: () => {
            reset();
            useScreenStore.getState().show("home");
        },

        toggleMark: (path) => {
            const marks = new Set(get().marks);
            if (!marks.delete(path)) marks.add(path);
            set({ marks });
        },

        setMarks: (paths) => set({ marks: new Set(paths) }),

        clearMarks: () => set({ marks: new Set() }),

        ...deletionActions(get, set, () => markedShown(get()).length > 0, remove),

        restore: async (requested) => {
            const { run, files, gone, deletion } = get();
            if (deletion.status !== "idle") return;

            // A deleted file is never sent: only the Trash can give a file back.
            const items = removable(
                { files },
                requested.filter((path) => gone.get(path) === "trash"),
            );
            if (items.length === 0) return;
            set({ deletion: { status: "restoring" } });

            const { identities, ...settled } = await restoreFiles(items);
            forRun(run, () => {
                const notice: ScanNotice = { action: "restore", ...settled };
                const state = get();
                const gone = new Map(state.gone);
                const marks = new Set(state.marks);
                for (const path of notice.done) {
                    gone.delete(path);
                    marks.add(path);
                }
                // A restored file can come back under a new identity, which `thumb://` and a later removal need.
                const files = state.files.map((file) => {
                    const identity = identities.get(file.path);
                    return identity ? { ...file, identity } : file;
                });

                set({ files, gone, marks, deletion: IDLE.deletion, notice });
                useGalleryStore.getState().reinstate(files.filter((file) => identities.has(file.path)));
            });
        },

        dismissNotice: () => set(({ notice: _dismissed, ...rest }) => rest, true),
    };
});
