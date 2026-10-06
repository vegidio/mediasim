import { useEffect, useRef } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePairResultStore } from "@/stores/pairResult";
import { usePairViewStore } from "@/stores/pairView";
import { MediaPane } from "./MediaPane";
import { ScorePanel } from "./ScorePanel";
import { SliderPane } from "./SliderPane";

/** The pair result screen: the similarity of the pair chosen on the start screen, and each file's details. */
export const PairResultScreen = () => {
    const files = usePairResultStore((state) => state.files);
    const details = usePairResultStore((state) => state.details);
    const comparison = usePairResultStore((state) => state.comparison);
    const retry = usePairResultStore((state) => state.retry);
    const leave = usePairResultStore((state) => state.leave);
    const marked = usePairResultStore((state) => state.marked);
    const toggleMark = usePairResultStore((state) => state.toggleMark);
    const trashed = usePairResultStore((state) => state.trashed);
    const mode = usePairViewStore((state) => state.mode);
    const setMode = usePairViewStore((state) => state.setMode);
    const position = usePairViewStore((state) => state.position);
    const setPosition = usePairViewStore((state) => state.setPosition);
    const back = useRef<HTMLButtonElement>(null);

    // Compare, which opened this screen, is gone, so focus lands on the way back.
    useEffect(() => back.current?.focus(), []);

    return (
        <Tabs
            value={mode}
            onValueChange={(value) => setMode(value === "slider" ? "slider" : "side")}
            className="flex min-h-0 w-full flex-1 flex-col gap-5"
        >
            <div className="flex shrink-0 items-center justify-between">
                <Button ref={back} variant="outline" onClick={leave} className="h-9 gap-2 px-3.5">
                    <ArrowLeftIcon aria-hidden="true" />
                    New comparison
                </Button>
                <TabsList aria-label="View mode">
                    <TabsTrigger value="side">Side by side</TabsTrigger>
                    <TabsTrigger value="slider">Slider</TabsTrigger>
                </TabsList>
            </div>

            <ScorePanel comparison={comparison} onRetry={retry} canRetry={!trashed.a && !trashed.b} />

            {files && (
                <>
                    <TabsContent value="side" className="grid min-h-[360px] flex-1 grid-cols-2 gap-5">
                        <MediaPane
                            slot="a"
                            file={files.a}
                            details={details.a}
                            other={details.b}
                            marked={marked.a}
                            onToggleMark={() => toggleMark("a")}
                            trashed={trashed.a}
                        />
                        <MediaPane
                            slot="b"
                            file={files.b}
                            details={details.b}
                            other={details.a}
                            marked={marked.b}
                            onToggleMark={() => toggleMark("b")}
                            trashed={trashed.b}
                        />
                    </TabsContent>
                    <TabsContent value="slider" className="flex min-h-[360px] flex-1 flex-col">
                        <SliderPane
                            files={files}
                            details={details}
                            position={position}
                            onPositionChange={setPosition}
                            marked={marked}
                            onToggleMark={toggleMark}
                            trashed={trashed}
                        />
                    </TabsContent>
                </>
            )}
        </Tabs>
    );
};
