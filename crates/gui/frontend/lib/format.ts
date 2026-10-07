/** A media file count: `1 file`, `48 files`. */
export const formatCount = (count: number) => (count === 1 ? "1 file" : `${count} files`);

/** The combined size of `files`, in bytes. */
export const totalSize = (files: readonly { size: number }[]) => files.reduce((total, file) => total + file.size, 0);

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

/** `value` with a leading zero below 10: `05`, `42`. */
export const pad = (value: number) => String(value).padStart(2, "0");

/** A duration as `M:SS` below an hour and `H:MM:SS` from an hour, with the seconds rounded down. */
export const formatDuration = (seconds: number) => {
    const whole = Math.floor(seconds);
    const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];

    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
