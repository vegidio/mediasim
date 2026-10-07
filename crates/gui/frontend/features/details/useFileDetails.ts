import { useEffect, useState } from "react";
import { type MediaInfo, probeMedia } from "@/ipc/pair";
import { displayPath } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import type { FileDetails } from "./rows";

/**
 * Each file's details and display path, by path. A file shown again, as when stepping back, isn't read again, and
 * holding → reads each file once.
 */
const probes = new Map<string, Promise<MediaInfo>>();
const paths = new Map<string, Promise<string>>();

/** `load(key)`, read once per key into `cache`. A read that failed isn't kept, so the next call reads again. */
const cached = <T>(cache: Map<string, Promise<T>>, key: string, load: (key: string) => Promise<T>) => {
    const known = cache.get(key);
    if (known) return known;

    const read = load(key);
    cache.set(key, read);
    read.catch(() => {
        if (cache.get(key) === read) cache.delete(key);
    });
    return read;
};

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
    const shown = cached(paths, path, displayPath).catch(() => path);
    const streams = type === "video" ? probeVideo(identity).catch(() => undefined) : undefined;

    try {
        const info = await cached(probes, path, probeMedia);
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
