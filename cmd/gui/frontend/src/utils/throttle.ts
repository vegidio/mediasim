const MAX_CONCURRENT = 8;
let active = 0;
const pending: (() => void)[] = [];

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

export const releaseSlot = () => {
    active--;
    const next = pending.shift();
    if (next) next();
};
