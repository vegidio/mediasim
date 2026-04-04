import { basename } from 'pathe';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ImageEntry = {
    path: string;
    filename: string;
    blobUrl: string | null;
    loading: boolean;
};

type ImagesStore = {
    images: ImageEntry[];
    setImages: (paths: string[]) => void;
    setThumbnail: (path: string, blobUrl: string) => void;
    clear: () => void;
};

export const useImagesStore = create<ImagesStore>()(
    immer((set) => ({
        images: [],

        setImages: (paths: string[]) => {
            set((state) => {
                // Revoke old blob URLs to prevent memory leaks
                for (const img of state.images) {
                    if (img.blobUrl) {
                        URL.revokeObjectURL(img.blobUrl);
                    }
                }

                state.images = paths.map((path) => ({
                    path,
                    filename: basename(path),
                    blobUrl: null,
                    loading: false,
                }));
            });
        },

        setThumbnail: (path: string, blobUrl: string) => {
            set((state) => {
                const entry = state.images.find((img) => img.path === path);
                if (entry) {
                    entry.blobUrl = blobUrl;
                    entry.loading = false;
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
