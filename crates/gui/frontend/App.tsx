import { PairResultScreen } from "@/features/pair/PairResultScreen";
import { Header } from "@/features/shell/Header";
import { StartScreen } from "@/features/start/StartScreen";
import { useScreenStore } from "@/stores/screen";

/** The application shell: the header, and below it the current screen in a vertically scrolling main area. */
const App = () => {
    const current = useScreenStore((state) => state.screen);

    return (
        <div className="flex h-screen flex-col bg-background text-foreground">
            {current === "pair" ? <Header title="Compare two files" /> : <Header current="select" />}
            <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-10">
                {current === "pair" ? <PairResultScreen /> : <StartScreen />}
            </main>
        </div>
    );
};

export default App;
