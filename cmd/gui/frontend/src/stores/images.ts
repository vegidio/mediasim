import type { MediaInfo } from '@bindings/gui/services/models.js';
import { basename } from 'pathe';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ImageEntry = {
    path: string;
    filename: string;
    blobUrl: string | undefined;
    loading: boolean;
    modTime: number | undefined;
    fileSize: number | undefined;
    width: number | undefined;
    height: number | undefined;
};

type ImagesStore = {
    images: ImageEntry[];
    setImages: (mediaInfos: MediaInfo[]) => void;
    setLoading: (path: string) => void;
    setThumbnail: (path: string, blobUrl: string, width: number, height: number) => void;
    clear: () => void;
};

export const useImagesStore = create<ImagesStore>()(
    immer((set) => ({
        images: [],

        setImages: (mediaInfos: MediaInfo[]) => {
            set((state) => {
                // Revoke old blob URLs to prevent memory leaks
                for (const img of state.images) {
                    if (img.blobUrl) {
                        URL.revokeObjectURL(img.blobUrl);
                    }
                }

                state.images = mediaInfos.map((info) => ({
                    path: info.path,
                    filename: basename(info.path),
                    blobUrl: undefined,
                    loading: false,
                    modTime: info.modTime,
                    fileSize: info.fileSize,
                    width: undefined,
                    height: undefined,
                }));
            });
        },

        setLoading: (path: string) => {
            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) entry.loading = true;
            });
        },

        setThumbnail: (path: string, blobUrl: string, width: number, height: number) => {
            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.blobUrl = blobUrl;
                    entry.loading = false;
                    entry.width = width;
                    entry.height = height;
                }
            });
        },

        clear: () => {
            set((state) => {
                for (const img of state.images) {
                    if (img.blobUrl) {
                        URL.revokeObjectURL(img.blobUrl);
                    }
                }
                state.images = [];
            });
        },
    })),
);
