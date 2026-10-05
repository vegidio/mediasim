import { open } from "@tauri-apps/plugin-dialog";
import type { MediaFormat } from "./formats";

/** The plugin answers `null` when the picker is cancelled. */
const asList = (picked: string[] | null) => picked ?? [];

/**
 * The picker filter for media files. It lists each extension in lowercase and uppercase: Windows and macOS match
 * filters case-insensitively, but GTK on Linux may not, and would otherwise hide `IMG_0001.JPG`.
 */
const mediaFilters = (formats: MediaFormat[]) => [
    {
        name: "Images and videos",
        extensions: formats.flatMap((format) => format.extensions).flatMap((ext) => [ext, ext.toUpperCase()]),
    },
];

/** Let the user pick media files, several at once. Resolves to `[]` when the picker is cancelled. */
export const pickFiles = async (formats: MediaFormat[]) =>
    asList(await open({ multiple: true, directory: false, filters: mediaFilters(formats) }));

/** Let the user pick one media file. Resolves to `undefined` when the picker is cancelled. */
export const pickFile = async (formats: MediaFormat[]) =>
    (await open({ multiple: false, directory: false, filters: mediaFilters(formats) })) ?? undefined;

/** Let the user pick folders, several at once. Resolves to `[]` when the picker is cancelled. */
export const pickFolders = async () => asList(await open({ multiple: true, directory: true }));
