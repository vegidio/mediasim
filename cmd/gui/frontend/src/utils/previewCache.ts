import { LRUCache } from 'lru-cache';

type PreviewData = {
    dataUrl: string;
    width: number;
    height: number;
};

const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

const cache = new LRUCache<string, PreviewData>({
    maxSize: MAX_SIZE,
    sizeCalculation: (value) => value.dataUrl.length,
});

export const getCachedPreview = (path: string) => cache.get(path);

export const setCachedPreview = (path: string, data: PreviewData) => cache.set(path, data);
