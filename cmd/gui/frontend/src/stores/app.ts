import { basename } from 'pathe';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { TILE_MIN_SIZE } from '@/utils/constants.ts';

type DirectoryEntry = {
    path: string;
    name: string;
    lastUsed: number;
};

type AppStore = {
    recentDirectories: DirectoryEntry[];
    selectedDirectory?: string;
    tileSize: number;
    addDirectory: (path: string) => void;
    selectDirectory: (path: string) => void;
    clearSelectedDirectory: () => void;
    setTileSize: (size: number) => void;
};

const MAX_RECENT_DIRECTORIES = 5;

export const useAppStore = create<AppStore>()(
    persist(
        immer((set, get) => ({
            recentDirectories: [],
            selectedDirectory: undefined,
            tileSize: TILE_MIN_SIZE,

            addDirectory: (path: string) => {
                const name = basename(path);
                set((state) => {
                    state.recentDirectories = state.recentDirectories.filter((d) => d.path !== path);
                    state.recentDirectories.unshift({ path, name, lastUsed: Date.now() });
                    state.recentDirectories = state.recentDirectories.slice(0, MAX_RECENT_DIRECTORIES);
                });
            },

            selectDirectory: (path: string) => {
                set((state) => {
                    state.selectedDirectory = path;
                });
                get().addDirectory(path);
            },

            clearSelectedDirectory: () => {
                set((state) => {
                    state.selectedDirectory = undefined;
                });
            },

            setTileSize: (size: number) => {
                set((state) => {
                    state.tileSize = size;
                });
            },
        })),
        {
            name: 'app-store',
            partialize: (state) => ({ recentDirectories: state.recentDirectories, tileSize: state.tileSize }),
        },
    ),
);
