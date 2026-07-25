import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export type MediaType = 'all' | 'images' | 'videos';

type SettingsStore = {
    mediaType: MediaType;
    frameFlip: boolean;
    frameRotate: boolean;
    threshold: number;
    ignoreErrors: boolean;
    setMediaType: (mediaType: MediaType) => void;
    setFrameFlip: (frameFlip: boolean) => void;
    setFrameRotate: (frameRotate: boolean) => void;
    setThreshold: (threshold: number) => void;
    setIgnoreErrors: (ignoreErrors: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        immer((set) => ({
            mediaType: 'all',
            frameFlip: false,
            frameRotate: false,
            threshold: 0.8,
            ignoreErrors: false,

            setMediaType: (mediaType: MediaType) => {
                set((state) => {
                    state.mediaType = mediaType;
                });
            },

            setFrameFlip: (frameFlip: boolean) => {
                set((state) => {
                    state.frameFlip = frameFlip;
                });
            },

            setFrameRotate: (frameRotate: boolean) => {
                set((state) => {
                    state.frameRotate = frameRotate;
                });
            },

            setThreshold: (threshold: number) => {
                set((state) => {
                    state.threshold = threshold;
                });
            },

            setIgnoreErrors: (ignoreErrors: boolean) => {
                set((state) => {
                    state.ignoreErrors = ignoreErrors;
                });
            },
        })),
        {
            name: 'settings-store',
            partialize: (state) => ({
                mediaType: state.mediaType,
                frameFlip: state.frameFlip,
                frameRotate: state.frameRotate,
                threshold: state.threshold,
                ignoreErrors: state.ignoreErrors,
            }),
        },
    ),
);
