import type { MediaInfo } from '@bindings/gui/services/models.js';
import { basename } from 'pathe';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { hasCachedThumbnail, setCachedThumbnail } from '@/utils/thumbnailCache';

type ThumbnailStatus = 'idle' | 'loading' | 'loaded';

type ImageEntry = {
    path: string;
    filename: string;
    modTime?: number;
    fileSize?: number;
};

type ImagesStore = {
    images: ImageEntry[];
    statusByPath: Record<string, ThumbnailStatus>;
    setImages: (mediaInfos: MediaInfo[]) => void;
    setLoading: (path: string) => void;
    setThumbnailLoaded: (path: string, url: string, width: number, height: number) => void;
    clear: () => void;
};

export const useImagesStore = create<ImagesStore>()(
    immer((set) => ({
        images: [],
        statusByPath: {},

        setImages: (mediaInfos: MediaInfo[]) => {
            set((state) => {
                state.images = mediaInfos.map((info) => ({
                    path: info.path,
                    filename: basename(info.path),
                    modTime: info.modTime,
                    fileSize: info.fileSize,
                }));

                state.statusByPath = {};
                for (const info of mediaInfos) {
                    state.statusByPath[info.path] = hasCachedThumbnail(info.path) ? 'loaded' : 'idle';
                }
            });
        },

        setLoading: (path: string) => {
            set((state) => {
                state.statusByPath[path] = 'loading';
            });
        },

        setThumbnailLoaded: (path: string, url: string, width: number, height: number) => {
            setCachedThumbnail(path, { url, width, height });

            set((state) => {
                state.statusByPath[path] = 'loaded';
            });
        },

        clear: () => {
            set((state) => {
                state.images = [];
                state.statusByPath = {};
            });
        },
    })),
);
