import type { MediaInfo } from '@bindings/gui/services/models.js';
import { basename } from 'pathe';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { hasCachedThumbnail, setCachedThumbnail } from '@/utils/thumbnailCache';

type ImageEntry = {
    path: string;
    filename: string;
    status: 'idle' | 'loading' | 'loaded';
    modTime?: number;
    fileSize?: number;
};

type ImagesStore = {
    images: ImageEntry[];
    setImages: (mediaInfos: MediaInfo[]) => void;
    setLoading: (path: string) => void;
    setThumbnailLoaded: (path: string, url: string, width: number, height: number) => void;
    clear: () => void;
};

export const useImagesStore = create<ImagesStore>()(
    immer((set) => ({
        images: [],

        setImages: (mediaInfos: MediaInfo[]) => {
            set((state) => {
                state.images = mediaInfos.map((info) => ({
                    path: info.path,
                    filename: basename(info.path),
                    status: hasCachedThumbnail(info.path) ? 'loaded' : 'idle',
                    modTime: info.modTime,
                    fileSize: info.fileSize,
                }));
            });
        },

        setLoading: (path: string) => {
            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.status = 'loading';
                } else {
                    state.images.push({ path, filename: basename(path), status: 'loading' });
                }
            });
        },

        setThumbnailLoaded: (path: string, url: string, width: number, height: number) => {
            setCachedThumbnail(path, { url, width, height });

            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.status = 'loaded';
                } else {
                    state.images.push({ path, filename: basename(path), status: 'loaded' });
                }
            });
        },

        clear: () => {
            set((state) => {
                state.images = [];
            });
        },
    })),
);
