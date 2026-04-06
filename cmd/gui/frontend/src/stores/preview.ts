import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type PreviewStore = {
    previewPath?: string;
    openPreview: (path: string) => void;
    closePreview: () => void;
};

export const usePreviewStore = create<PreviewStore>()(
    immer((set) => ({
        previewPath: undefined,

        openPreview: (path) =>
            set((state) => {
                state.previewPath = path;
            }),

        closePreview: () =>
            set((state) => {
                state.previewPath = undefined;
            }),
    })),
);
