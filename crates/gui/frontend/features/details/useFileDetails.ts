import { useEffect, useState } from "react";
import { type MediaInfo, probeMedia } from "@/ipc/pair";
import { displayPath } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import { createLru, readOnce } from "@/lib/lru";
import type { FileDetails } from "./rows";

/** How many files' details are kept. */
const KEPT = 500;

/**
 * The details of the files shown last, by identity, which changes when the file does, and their display paths, by
 * path. A file shown again, as when stepping back, isn't read again, and holding → reads each file once.
 */
const probes = createLru<string, Promise<MediaInfo>>(KEPT);
const paths = createLru<string, Promise<string>>(KEPT);

/** Forget every file's details read so far, so each test starts with none. */
export const forgetFileDetails = () => {
    probes.clear();
    paths.clear();
};

const LOADING: FileDetails = { status: "loading" };

/**
 * Everything the sidebar lists about `file`. Only its own details decide whether it is read: a display path that
 * can't be had falls back to the full path, and a video's streams that can't be read leave only their rows unknown.
 */
const read = async ({ path, type, identity }: MediaFile): Promise<FileDetails> => {
    const shown = readOnce(paths, path, displayPath).catch(() => path);
    const streams = type === "video" ? probeVideo(identity).catch(() => undefined) : undefined;

    try {
        const info = await readOnce(probes, identity, () => probeMedia(path));
        const [display, probe] = await Promise.all([shown, streams]);
        return { status: "ready", info, path: display, ...(probe && { streams: probe }) };
    } catch (error) {
        console.error("could not read the file's details", error);
        return { status: "failed" };
    }
};

/** The details of `file`, loading until they are read. An answer for a file no longer shown is dropped. */
export const useFileDetails = (file: MediaFile): FileDetails => {
    const [answer, setAnswer] = useState<{ path: string; details: FileDetails }>();
    const { path } = file;

    useEffect(() => {
        let live = true;
        void read(file).then((details) => live && setAnswer({ path: file.path, details }));

        return () => {
            live = false;
        };
    }, [file]);

    return answer?.path === path ? answer.details : LOADING;
};
