import { create } from "zustand";

/** UI state of the application shell itself, as opposed to any feature inside it. */
type ShellStore = {
    /** Whether the sidebar is shown. */
    sidebarOpen: boolean;

    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
};

export const useShellStore = create<ShellStore>()((set) => ({
    sidebarOpen: true,

    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
