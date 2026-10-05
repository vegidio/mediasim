import { PanelLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useShellStore } from "@/stores/shell";

/** The application shell: a toolbar, a sidebar and the main area, all still empty. */
const App = () => {
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const toggleSidebar = useShellStore((state) => state.toggleSidebar);

    return (
        <div className="flex h-screen flex-col bg-background text-foreground">
            <header className="flex h-12 shrink-0 items-center gap-2 px-2">
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                    aria-pressed={sidebarOpen}
                    onClick={toggleSidebar}
                >
                    <PanelLeftIcon />
                </Button>
                <h1 className="font-medium text-sm">MediaSim</h1>
            </header>
            <Separator />
            <div className="flex min-h-0 flex-1">
                {sidebarOpen && (
                    <>
                        <aside aria-label="Sidebar" className="w-64 shrink-0" />
                        <Separator orientation="vertical" />
                    </>
                )}
                <main className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
                    No media to compare yet.
                </main>
            </div>
        </div>
    );
};

export default App;
