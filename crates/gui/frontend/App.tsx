import { GalleryScreen } from "@/features/gallery/GalleryScreen";
import { GroupsScreen } from "@/features/groups/GroupsScreen";
import { HomeScreen } from "@/features/home/HomeScreen";
import { DeletionFooter } from "@/features/pair/DeletionFooter";
import { DeletionNotice } from "@/features/pair/DeletionNotice";
import { PairResultScreen } from "@/features/pair/PairResultScreen";
import { ScanScreen } from "@/features/scan/ScanScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { Header } from "@/features/shell/Header";
import { cn } from "@/lib/utils";
import { useScreenStore } from "@/stores/screen";

/**
 * The application shell: the header, below it the current screen in a vertically scrolling main area (the gallery and
 * the groups screen scroll their own area below their toolbar instead), and on the pair screen the deletion footer,
 * which stays in view below the main area rather than scrolling with it, and the notice of the last deletion, floating
 * 20 px above the footer over the main area without scrolling with it.
 */
const App = () => {
    const current = useScreenStore((state) => state.screen);

    return (
        <div className="flex h-screen flex-col bg-background text-foreground">
            {current === "pair" ? (
                <Header title="Compare two files" />
            ) : current === "settings" ? (
                <Header title="Settings" />
            ) : current === "scan" ? (
                <Header current="compare" />
            ) : current === "groups" ? (
                <Header current="review" />
            ) : (
                <Header current="select" />
            )}
            <div className="relative flex min-h-0 flex-1 flex-col">
                <main
                    className={cn(
                        "flex min-h-0 flex-1 flex-col",
                        current === "gallery" || current === "groups" ? "overflow-hidden" : "overflow-y-auto p-10",
                    )}
                >
                    {current === "pair" ? (
                        <PairResultScreen />
                    ) : current === "settings" ? (
                        <SettingsScreen />
                    ) : current === "gallery" ? (
                        <GalleryScreen />
                    ) : current === "scan" ? (
                        <ScanScreen />
                    ) : current === "groups" ? (
                        <GroupsScreen />
                    ) : (
                        <HomeScreen />
                    )}
                </main>
                {current === "pair" && <DeletionNotice className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2" />}
            </div>
            {current === "pair" && <DeletionFooter />}
        </div>
    );
};

export default App;
