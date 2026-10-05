import { open } from "@tauri-apps/plugin-dialog";
import type { MediaFormat } from "./formats";

/** The plugin answers `null` when the picker is cancelled. */
const asList = (picked: string[] | null) => picked ?? [];

/**
 * Let the user pick media files, several at once. Resolves to `[]` when the picker is cancelled.
 *
 * The filter lists each extension in lowercase and uppercase: Windows and macOS match filters case-insensitively, but
 * GTK on Linux may not, and would otherwise hide `IMG_0001.JPG`.
 */
export const pickFiles = async (formats: MediaFormat[]) => {
    const extensions = formats.flatMap((format) => format.extensions).flatMap((ext) => [ext, ext.toUpperCase()]);

    return asList(
        await open({ multiple: true, directory: false, filters: [{ name: "Images and videos", extensions }] }),
    );
};

/** Let the user pick folders, several at once. Resolves to `[]` when the picker is cancelled. */
export const pickFolders = async () => asList(await open({ multiple: true, directory: true }));
