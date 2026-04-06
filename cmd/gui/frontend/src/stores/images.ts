import type { MediaInfo } from '@bindings/gui/services/models.js';
import { basename } from 'pathe';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getCachedThumbnail, setCachedThumbnail } from '@/utils/thumbnailCache';

type ImageEntry = {
    path: string;
    filename: string;
    loading: boolean;
    loaded: boolean;
    modTime?: number;
    fileSize?: number;
};

type ImagesStore = {
    images: ImageEntry[];
    setImages: (mediaInfos: MediaInfo[]) => void;
    setLoading: (path: string) => void;
    setThumbnailLoaded: (path: string, dataUrl: string, width: number, height: number) => void;
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
                    loading: false,
                    loaded: !!getCachedThumbnail(info.path),
                    modTime: info.modTime,
                    fileSize: info.fileSize,
                }));
            });
        },

        setLoading: (path: string) => {
            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.loading = true;
                } else {
                    state.images.push({ path, filename: basename(path), loading: true, loaded: false });
                }
            });
        },

        setThumbnailLoaded: (path: string, dataUrl: string, width: number, height: number) => {
            setCachedThumbnail(path, { dataUrl, width, height });

            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.loaded = true;
                    entry.loading = false;
                } else {
                    state.images.push({ path, filename: basename(path), loading: false, loaded: true });
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
