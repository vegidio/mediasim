const UNITS = ["kB", "MB", "GB", "TB"];

/** A byte count in decimal units, as file managers on macOS and Linux show it: `512 B`, `3.1 MB`, `1.2 GB`. */
export const formatSize = (bytes: number) => {
    if (bytes < 1000) {
        return `${bytes} B`;
    }

    let value = bytes / 1000;
    let unit = 0;
    // Promote on the rounded value too, so 999,999 bytes reads `1.0 MB` rather than `1000.0 kB`.
    while (unit < UNITS.length - 1 && Number(value.toFixed(1)) >= 1000) {
        value /= 1000;
        unit += 1;
    }

    return `${value.toFixed(1)} ${UNITS[unit]}`;
};

/** A media file count: `1 file`, `48 files`. */
export const formatCount = (count: number) => (count === 1 ? "1 file" : `${count} files`);
