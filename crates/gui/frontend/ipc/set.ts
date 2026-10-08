import { invoke } from "@tauri-apps/api/core";
import type { MediaFile } from "./thumbs";

/** The icon a set row gets. */
export type SourceKind = "folder" | "image" | "video";

/** One added file or folder, as `crates/gui/src/set.rs` describes it. */
export type SourceView = {
    /** The path as added, which identifies the source to {@link removeFromSet}. */
    path: string;
    name: string;
    /** A folder's own path, or a file's parent, with `~` for the home folder on macOS and Linux. */
    location: string;
    kind: SourceKind;
    /** The media files this source contributes on its own. */
    count: number;
    /** The total size of those files, in bytes. */
    size: number;
    /** A folder that could not be read; it counts 0 files. */
    unreadable: boolean;
    /** A folder still being counted. */
    pending: boolean;
};

/** The whole set. */
export type SetView = {
    /** Increases with every change to the set; a view with a lower one is older. */
    revision: number;
    sources: SourceView[];
    /** The distinct media files across every counted source. */
    total: number;
};

/** Add files and folders; resolves once every folder added has been counted. */
export const addToSet = (paths: string[], recursive: boolean) => invoke<SetView>("add_to_set", { paths, recursive });

/** Remove the source added as `path`. */
export const removeFromSet = (path: string) => invoke<SetView>("remove_from_set", { path });

/** Remove every source, including folders still being counted. */
export const clearSet = () => invoke<SetView>("clear_set");

/** Recount every folder as it is on disk, with or without its subfolders; resolves once they are all counted. */
export const rescanSet = (recursive: boolean) => invoke<SetView>("rescan_set", { recursive });

/** The set's distinct media files, as `list_set_media` returns them. */
export type SetMedia = {
    /** The set's revision when its files were read, comparable with {@link SetView.revision}. */
    revision: number;
    /** Ordered by path; a file that can no longer be read is left out. */
    files: MediaFile[];
};

/** Admit every distinct media file in the set for thumbnails, and describe each one. */
export const listSetMedia = () => invoke<SetMedia>("list_set_media");

/** `path` as the set list shows a location: with `~` for the home folder on macOS and Linux, and in full on Windows. */
export const displayPath = (path: string) => invoke<string>("display_path", { path });
