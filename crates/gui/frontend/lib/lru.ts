/** A map that keeps the `limit` entries used last, forgetting the one used longest ago to make room for another. */
export type Lru<K, V extends object> = {
    /** The value of `key`, which counts as a use. */
    get: (key: K) => V | undefined;
    set: (key: K, value: V) => void;
    delete: (key: K) => void;
    clear: () => void;
};

export const createLru = <K, V extends object>(limit: number): Lru<K, V> => {
    // A Map iterates in insertion order, so moving an entry to the end on each use keeps the oldest first.
    const entries = new Map<K, V>();

    return {
        get: (key) => {
            const value = entries.get(key);
            if (!value) return;
            entries.delete(key);
            entries.set(key, value);
            return value;
        },
        set: (key, value) => {
            entries.delete(key);
            entries.set(key, value);
            for (const oldest of entries.keys()) {
                if (entries.size <= limit) break;
                entries.delete(oldest);
            }
        },
        delete: (key) => {
            entries.delete(key);
        },
        clear: () => entries.clear(),
    };
};

/** `load(key)`, read once per key into `cache`. A read that failed isn't kept, so the next call reads again. */
export const readOnce = <K, T>(cache: Lru<K, Promise<T>>, key: K, load: (key: K) => Promise<T>): Promise<T> => {
    const known = cache.get(key);
    if (known) return known;

    const read = load(key);
    cache.set(key, read);
    read.catch(() => {
        if (cache.get(key) === read) cache.delete(key);
    });
    return read;
};
