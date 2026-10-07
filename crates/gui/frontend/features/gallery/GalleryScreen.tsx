import { useEffect } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { type GalleryFilter, useGalleryStore } from "@/stores/gallery";
import { DetailsDialog } from "../details/DetailsDialog";
import { GalleryGrid } from "./GalleryGrid";
import { GalleryToolbar } from "./GalleryToolbar";

const isFilter = (value: string): value is GalleryFilter =>
    value === "images" || value === "videos" || value === "both";

/**
 * The selected media gallery: the toolbar over a grid of every file in the set, and the media details of one of them
 * when it is opened. The grid sits in the selected tab's panel, so the tabs control a real element; the panel is the
 * only part that scrolls.
 */
export const GalleryScreen = () => {
    const filter = useGalleryStore((state) => state.filter);
    const setFilter = useGalleryStore((state) => state.setFilter);
    const load = useGalleryStore((state) => state.load);
    const listing = useGalleryStore((state) => state.listing);
    const details = useGalleryStore((state) => state.details);

    useEffect(() => {
        void load();
    }, [load]);

    const files = listing.status === "ready" ? listing.files : undefined;
    const shown = details === undefined ? undefined : files?.find((file) => file.path === details);

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
            {files && shown && <DetailsDialog files={files} file={shown} />}
        </Tabs>
    );
};
