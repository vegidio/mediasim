const MAX_CONCURRENT = 8;
let active = 0;
const pending: (() => void)[] = [];

/**
 * Acquires a concurrency slot for an async operation.
 *
 * If the number of active operations is below MAX_CONCURRENT, the slot is granted immediately. Otherwise, the caller is
 * queued and will be resumed once a slot becomes available via `releaseSlot`.
 */
export const acquireSlot = (): Promise<void> => {
    if (active < MAX_CONCURRENT) {
        active++;
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        pending.push(() => {
            active++;
            resolve();
        });
    });
};

/**
 * Releases a previously acquired concurrency slot.
 *
 * Decrements the active count and, if there are queued callers waiting, dequeues the next one and grants it a slot
 * immediately.
 */
export const releaseSlot = () => {
    active--;
    const next = pending.shift();
    if (next) next();
};
