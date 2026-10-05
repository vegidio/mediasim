import { Header } from "@/features/shell/Header";
import { StartScreen } from "@/features/start/StartScreen";

/** The application shell: the header, and below it the current screen in a vertically scrolling main area. */
const App = () => (
    <div className="flex h-screen flex-col bg-background text-foreground">
        <Header current="select" />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-10">
            <StartScreen />
        </main>
    </div>
);

export default App;
