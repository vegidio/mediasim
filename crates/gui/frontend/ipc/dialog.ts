import { invoke } from "@tauri-apps/api/core";
import type { MediaFormat } from "./formats";

/** A picker filter, as `Filter` in `crates/gui/src/dialog.rs` reads it. */
type Filter = { name: string; extensions: string[] };

/**
 * The picker filter for media files. It lists each extension in lowercase and uppercase: Windows and macOS match
 * filters case-insensitively, but GTK on Linux may not, and would otherwise hide `IMG_0001.JPG`.
 */
const mediaFilters = (formats: MediaFormat[]): Filter[] => [
    {
        name: "Images and videos",
        extensions: formats.flatMap((format) => format.extensions).flatMap((ext) => [ext, ext.toUpperCase()]),
    },
];

/**
 * Let the user pick media files, several at once. Resolves to `[]` when the picker is cancelled. The picker is opened
 * by Rust, which records the files as chosen, so they can later be moved to the Trash or deleted.
 */
export const pickFiles = (formats: MediaFormat[]) => invoke<string[]>("pick_files", { filters: mediaFilters(formats) });

/**
 * Let the user pick one media file, recorded as chosen like {@link pickFiles}. Resolves to `undefined` when the picker
 * is cancelled.
 */
export const pickFile = async (formats: MediaFormat[]) =>
    // Rust's `None` arrives as `null`.
    (await invoke<string | null>("pick_file", { filters: mediaFilters(formats) })) ?? undefined;

/**
 * Let the user pick folders, several at once, recorded as chosen like {@link pickFiles}. Resolves to `[]` when the
 * picker is cancelled.
 */
export const pickFolders = () => invoke<string[]>("pick_folders");
