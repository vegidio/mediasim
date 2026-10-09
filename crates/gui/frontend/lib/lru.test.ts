import { describe, expect, it, vi } from "vitest";
import { createLru, readOnce } from "./lru";

describe("createLru", () => {
    it("keeps the entries used last, forgetting the one used longest ago", () => {
        const cache = createLru<string, { n: number }>(2);
        const [a, b, c] = [{ n: 1 }, { n: 2 }, { n: 3 }];
        cache.set("a", a);
        cache.set("b", b);
        // Using `a` makes `b` the oldest.
        expect(cache.get("a")).toBe(a);

        cache.set("c", c);

        expect(cache.get("a")).toBe(a);
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("c")).toBe(c);
    });

    it("replaces a key's value without making room for it", () => {
        const cache = createLru<string, { n: number }>(2);
        cache.set("a", { n: 1 });
        cache.set("b", { n: 2 });

        cache.set("a", { n: 3 });

        expect(cache.get("a")).toEqual({ n: 3 });
        expect(cache.get("b")).toEqual({ n: 2 });
    });

    it("deletes and clears", () => {
        const cache = createLru<string, { n: number }>(2);
        cache.set("a", { n: 1 });
        cache.set("b", { n: 2 });

        cache.delete("a");
        expect(cache.get("a")).toBeUndefined();
        cache.clear();
        expect(cache.get("b")).toBeUndefined();
    });
});

describe("readOnce", () => {
    it("reads each key once, sharing the read", async () => {
        const cache = createLru<string, Promise<number>>(4);
        const load = vi.fn(async (key: string) => key.length);

        const first = readOnce(cache, "abc", load);
        const second = readOnce(cache, "abc", load);

        expect(second).toBe(first);
        await expect(first).resolves.toBe(3);
        expect(load).toHaveBeenCalledOnce();
    });

    it("forgets a read that failed, so the next call reads again", async () => {
        const cache = createLru<string, Promise<number>>(4);
        const load = vi.fn().mockRejectedValueOnce(new Error("bad")).mockResolvedValueOnce(1);

        await expect(readOnce(cache, "a", load)).rejects.toThrow("bad");
        await expect(readOnce(cache, "a", load)).resolves.toBe(1);
        expect(load).toHaveBeenCalledTimes(2);
    });
});
