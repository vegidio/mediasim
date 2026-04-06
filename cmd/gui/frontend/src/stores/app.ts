import { basename } from 'pathe';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

type DirectoryEntry = {
    path: string;
    name: string;
    lastUsed: number;
};

type AppStore = {
    recentDirectories: DirectoryEntry[];
    selectedDirectory?: string;
    addDirectory: (path: string) => void;
    selectDirectory: (path: string) => void;
    clearSelectedDirectory: () => void;
};

const MAX_RECENT_DIRECTORIES = 5;

export const useAppStore = create<AppStore>()(
    persist(
        immer((set, get) => ({
            recentDirectories: [],
            selectedDirectory: undefined,

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
        })),
        {
            name: 'app-store',
            partialize: (state) => ({ recentDirectories: state.recentDirectories }),
        },
    ),
);
