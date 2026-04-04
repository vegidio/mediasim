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
    selectedDirectory: string | null;
    addDirectory: (path: string) => void;
    selectDirectory: (path: string) => void;
    removeDirectory: (path: string) => void;
};

export const useAppStore = create<AppStore>()(
    persist(
        immer((set, get) => ({
            recentDirectories: [],
            selectedDirectory: null,

            addDirectory: (path: string) => {
                const name = basename(path);
                set((state) => {
                    state.recentDirectories = state.recentDirectories.filter((d) => d.path !== path);
                    state.recentDirectories.unshift({ path, name, lastUsed: Date.now() });
                    state.recentDirectories = state.recentDirectories.slice(0, 10);
                });
            },

            selectDirectory: (path: string) => {
                set((state) => {
                    state.selectedDirectory = path;
                });
                get().addDirectory(path);
            },

            removeDirectory: (path: string) => {
                set((state) => {
                    state.recentDirectories = state.recentDirectories.filter((d) => d.path !== path);
                });
            },
        })),
        { name: 'app-store' },
    ),
);
