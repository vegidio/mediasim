import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export type MediaType = 'all' | 'images' | 'videos';

export type CompareSettings = {
    mediaType: MediaType;
    frameFlip: boolean;
    frameRotate: boolean;
    threshold: number;
};

type SettingsStore = CompareSettings & {
    setMediaType: (mediaType: MediaType) => void;
    setFrameFlip: (frameFlip: boolean) => void;
    setFrameRotate: (frameRotate: boolean) => void;
    setThreshold: (threshold: number) => void;
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        immer((set) => ({
            mediaType: 'all',
            frameFlip: false,
            frameRotate: false,
            threshold: 0.8,

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
        })),
        {
            name: 'settings-store',
            partialize: (state) => ({
                mediaType: state.mediaType,
                frameFlip: state.frameFlip,
                frameRotate: state.frameRotate,
                threshold: state.threshold,
            }),
        },
    ),
);
