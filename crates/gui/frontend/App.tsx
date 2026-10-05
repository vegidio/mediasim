import { DeletionFooter } from "@/features/pair/DeletionFooter";
import { PairResultScreen } from "@/features/pair/PairResultScreen";
import { Header } from "@/features/shell/Header";
import { StartScreen } from "@/features/start/StartScreen";
import { useScreenStore } from "@/stores/screen";

/**
 * The application shell: the header, below it the current screen in a vertically scrolling main area, and on the pair
 * screen the deletion footer, which stays in view below the main area rather than scrolling with it.
 */
const App = () => {
    const current = useScreenStore((state) => state.screen);

    return (
        <div className="flex h-screen flex-col bg-background text-foreground">
            {current === "pair" ? <Header title="Compare two files" /> : <Header current="select" />}
            <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-10">
                {current === "pair" ? <PairResultScreen /> : <StartScreen />}
            </main>
            {current === "pair" && <DeletionFooter />}
        </div>
    );
};

export default App;
