import { LRUCache } from 'lru-cache';

type ThumbnailData = {
    url: string;
    width: number;
    height: number;
};

const cache = new LRUCache<string, ThumbnailData>({
    max: 5000,
});

export const hasCachedThumbnail = (path: string) => cache.has(path);

export const getCachedThumbnail = (path: string) => cache.get(path);

export const setCachedThumbnail = (path: string, data: ThumbnailData) => cache.set(path, data);
