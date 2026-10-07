import { useEffect } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { type GalleryFilter, useGalleryStore } from "@/stores/gallery";
import { GalleryGrid } from "./GalleryGrid";
import { GalleryToolbar } from "./GalleryToolbar";

const isFilter = (value: string): value is GalleryFilter =>
    value === "images" || value === "videos" || value === "both";

/**
 * The selected media gallery: the toolbar over a grid of every file in the set. The grid sits in the selected tab's
 * panel, so the tabs control a real element; the panel is the only part that scrolls.
 */
export const GalleryScreen = () => {
    const filter = useGalleryStore((state) => state.filter);
    const setFilter = useGalleryStore((state) => state.setFilter);
    const load = useGalleryStore((state) => state.load);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <Tabs
            value={filter}
            onValueChange={(value) => isFilter(value) && setFilter(value)}
            className="min-h-0 flex-1 gap-0"
        >
            <GalleryToolbar />
            <TabsContent value={filter} className="flex min-h-0 flex-col">
                <GalleryGrid />
            </TabsContent>
        </Tabs>
    );
};
