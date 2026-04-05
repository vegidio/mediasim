import type { MediaInfo } from '@bindings/gui/services/models.js';
import { basename } from 'pathe';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ImageEntry = {
    path: string;
    filename: string;
    dataUrl?: string;
    loading: boolean;
    modTime?: number;
    fileSize?: number;
    width?: number;
    height?: number;
};

type ImagesStore = {
    images: ImageEntry[];
    setImages: (mediaInfos: MediaInfo[]) => void;
    setLoading: (path: string) => void;
    setThumbnail: (path: string, dataUrl: string, width: number, height: number) => void;
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
                    dataUrl: undefined,
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

        setThumbnail: (path: string, dataUrl: string, width: number, height: number) => {
            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.dataUrl = dataUrl;
                    entry.loading = false;
                    entry.width = width;
                    entry.height = height;
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
