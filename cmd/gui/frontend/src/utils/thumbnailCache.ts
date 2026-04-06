import { LRUCache } from 'lru-cache';

type ThumbnailData = {
    dataUrl: string;
    width: number;
    height: number;
};

const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

const cache = new LRUCache<string, ThumbnailData>({
    maxSize: MAX_SIZE,
    sizeCalculation: (value) => value.dataUrl.length,
});

export const hasCachedThumbnail = (path: string) => cache.has(path);

export const getCachedThumbnail = (path: string) => cache.get(path);

export const setCachedThumbnail = (path: string, data: ThumbnailData) => cache.set(path, data);
