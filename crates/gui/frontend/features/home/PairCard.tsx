import { useEffect, useRef } from "react";
import { Columns2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptySlot } from "@/features/home/EmptySlot";
import { FilledSlot } from "@/features/home/FilledSlot";
import { ModeCard } from "@/features/home/ModeCard";
import { route, SLOTS, type Slot } from "@/features/home/routePairDrop";
import { hits, type Point, useDropTarget } from "@/features/home/useDropTarget";
import { cn } from "@/lib/utils";
import { selectCanCompare, selectMismatch, usePairStore } from "@/stores/pair";
import { usePairResultStore } from "@/stores/pairResult";
import { useScreenStore } from "@/stores/screen";

/** The "Compare two files" mode card: two slots to choose or drop a file into, and Compare. */
export const PairCard = () => {
    const a = usePairStore((state) => state.a);
    const b = usePairStore((state) => state.b);
    const drop = usePairStore((state) => state.drop);
    const mismatch = usePairStore(selectMismatch);
    const canCompare = usePairStore(selectCanCompare);
    const open = usePairResultStore((state) => state.open);
    const cardRef = useRef<HTMLElement>(null);
    const compareRef = useRef<HTMLButtonElement>(null);
    const slotRefs = { a: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null) };
    // The slot whose file was just removed, whose empty button takes focus as it mounts.
    const focusNext = useRef<Slot>(undefined);

    // Compare opened the pair result screen, which unmounted this card; coming back from there, focus returns to it,
    // once, so a later remount on the Home screen leaves focus alone.
    useEffect(() => {
        if (useScreenStore.getState().takePrevious() === "pair") compareRef.current?.focus();
    }, []);

    /** The slot under a position in CSS pixels, or `undefined` outside both. */
    const slotAt = (position: Point) => SLOTS.find((slot) => hits(slotRefs[slot].current, position));

    // The whole card is the one drop target, and resolves which slot the drop landed on itself.
    const { isOver, position, count } = useDropTarget(cardRef, (paths, at) => drop(paths, slotAt(at)));
    // While dragging, every dragged path counts: only the drop itself knows which ones can be placed.
    const highlighted = isOver && position ? route(count, slotAt(position), { a: !!a, b: !!b }) : [];
    const files = { a, b };

    return (
        <ModeCard
            ref={cardRef}
            icon={<Columns2Icon aria-hidden="true" />}
            title="Compare two files"
            description="Get one similarity score for two images or two videos."
        >
            <div className="grid grid-cols-2 gap-3">
                {SLOTS.map((slot) => {
                    const file = files[slot];

                    return (
                        <div key={slot} ref={slotRefs[slot]} className="min-w-0">
                            {file ? (
                                <FilledSlot
                                    slot={slot}
                                    file={file}
                                    highlighted={highlighted.includes(slot)}
                                    onRemove={() => {
                                        focusNext.current = slot;
                                    }}
                                />
                            ) : (
                                <EmptySlot
                                    slot={slot}
                                    highlighted={highlighted.includes(slot)}
                                    ref={(button) => {
                                        if (button && focusNext.current === slot) {
                                            focusNext.current = undefined;
                                            button.focus();
                                        }
                                    }}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="mt-auto flex items-center justify-between gap-4">
                {/* The hint's text is the same either way, so the hidden prefix is what makes the region announce. */}
                <div aria-live="polite" className="text-[13px]">
                    {mismatch && <span className="sr-only">Warning: </span>}
                    <span
                        className={cn("flex items-center gap-1.5", mismatch ? "text-warning" : "text-muted-foreground")}
                    >
                        {mismatch && <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                        Both files must be images, or both videos.
                    </span>
                </div>
                <Button
                    disabled={!canCompare}
                    ref={compareRef}
                    onClick={() => {
                        if (a && b) open(a, b);
                    }}
                    className="h-10 px-[18px] text-sm"
                >
                    Compare
                </Button>
            </div>
        </ModeCard>
    );
};
