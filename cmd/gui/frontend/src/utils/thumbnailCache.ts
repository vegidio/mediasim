import { LRUCache } from 'lru-cache';

type ThumbnailData = {
    dataUrl: string;
    width: number;
    height: number;
};

const cache = new LRUCache<string, ThumbnailData>({ max: 1500 });

export const getCachedThumbnail = (path: string): ThumbnailData | undefined => cache.get(path);

export const setCachedThumbnail = (path: string, data: ThumbnailData): void => {
    cache.set(path, data);
};
