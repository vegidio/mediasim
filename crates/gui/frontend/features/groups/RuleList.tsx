import { useId, useRef } from "react";
import {
    type Announcements,
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    type Modifier,
    PointerSensor,
    type ScreenReaderInstructions,
    type UniqueIdentifier,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import { GripVerticalIcon, VideoIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { moveRule, RULE_INFO, type Rule, type RuleId } from "./rules";

/** Keeps a lifted row in its column: the rows only move up and down. */
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const INSTRUCTIONS: ScreenReaderInstructions = {
    draggable:
        "To move a rule, press Space or Enter to lift it, the up and down arrow keys to move it, then Space or Enter to drop it, or Escape to put it back.",
};

type RuleRowProps = {
    rule: Rule;
    rank: number;
    onToggle: (on: boolean) => void;
};

/** One rule: its grip, its rank, its label over its hint, the "Videos only" pill on the video length, and its switch. */
const RuleRow = ({ rule: { id, on }, rank, onToggle }: RuleRowProps) => {
    const { label, hint, videoOnly } = RULE_INFO[id];
    const hintId = useId();
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
        id,
    });

    return (
        // The whole row takes the pointer; only the grip lifts it from the keyboard, as dnd-kit's activator.
        <li
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            {...listeners}
            className={cn(
                "relative flex cursor-grab touch-none items-center gap-3 bg-[#0F0F11] px-3.5 py-3",
                isDragging && "z-10 cursor-grabbing shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
            )}
        >
            <button
                type="button"
                ref={setActivatorNodeRef}
                {...attributes}
                aria-label={`Reorder ${label}`}
                className="-m-1 flex shrink-0 cursor-grab rounded p-1 text-[#52525B] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <GripVerticalIcon aria-hidden="true" className="size-4" />
            </button>
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md border border-[#27272A] bg-[#18181B] font-mono text-[#A1A1AA] text-[11px]">
                {rank}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                    <span className={cn("font-medium text-sm", on ? "text-[#FAFAFA]" : "text-[#A1A1AA]")}>{label}</span>
                    {videoOnly && (
                        <span
                            title="Applies to video files only"
                            className="flex h-[18px] items-center gap-1 rounded-full border border-[#3F3F46] bg-[#18181B] px-1.5 font-medium text-[#A1A1AA] text-[11px]"
                        >
                            <VideoIcon aria-hidden="true" className="size-[11px]" strokeWidth={2.2} />
                            Videos only
                        </span>
                    )}
                </span>
                <span id={hintId} className="text-[#A1A1AA] text-xs">
                    {hint}
                </span>
            </span>
            <Switch
                aria-label={label}
                aria-describedby={hintId}
                checked={on}
                onCheckedChange={onToggle}
                // A press on the switch toggles it, and never starts a drag.
                onPointerDown={(event) => event.stopPropagation()}
                className="border-0 p-0.5 data-[size=default]:h-[22px] data-[size=default]:w-10 data-checked:bg-[#BEF264] data-unchecked:bg-[#3F3F46] dark:data-unchecked:bg-[#3F3F46]"
                thumbClassName="bg-[#FAFAFA] shadow-[0_1px_2px_rgba(0,0,0,.4)] group-data-[size=default]/switch:size-[18px] group-data-[size=default]/switch:data-checked:translate-x-[18px] dark:data-checked:bg-[#FAFAFA] dark:data-unchecked:bg-[#FAFAFA]"
            />
        </li>
    );
};

type RuleListProps = {
    /** The rules, in the order they are applied. */
    rules: readonly Rule[];
    /** Called with the rules reordered or a rule switched. */
    onChange: (rules: Rule[]) => void;
    /** Called with `true` when a row is lifted, and `false` when it is dropped or put back. */
    onDraggingChange?: (dragging: boolean) => void;
};

/**
 * The Auto-select rules (9b, 10b): "Keep the file with…", then one row per rule in order, each with its rank and an
 * on/off switch. Rows reorder by dragging them, or from the keyboard on their grips, and assistive technology hears
 * each rule's label and place as it moves.
 */
export const RuleList = ({ rules, onChange, onDraggingChange }: RuleListProps) => {
    // The place a lifted row was last announced over: dnd-kit reports it over its own place as soon as it is lifted, and
    // that would talk over "Picked up".
    const announcedOver = useRef<UniqueIdentifier>(undefined);
    const sensors = useSensors(
        // A few pixels before a press becomes a drag, so a click on a row stays a click.
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const ids = rules.map((rule) => rule.id);
    const place = (id?: UniqueIdentifier) => ids.indexOf(id as RuleId) + 1;
    const label = (id: UniqueIdentifier) => RULE_INFO[id as RuleId].label;

    const announcements: Announcements = {
        onDragStart: ({ active }) => {
            announcedOver.current = active.id;
            return `Picked up ${label(active.id)}, in place ${place(active.id)}.`;
        },
        onDragOver: ({ active, over }) => {
            if (!over || over.id === announcedOver.current) return;
            announcedOver.current = over.id;
            return `${label(active.id)} moved to place ${place(over.id)}.`;
        },
        onDragEnd: ({ active, over }) =>
            over
                ? `${label(active.id)} dropped in place ${place(over.id)}.`
                : `${label(active.id)} returned to place ${place(active.id)}.`,
        onDragCancel: ({ active }) => `${label(active.id)} returned to place ${place(active.id)}.`,
    };

    const onDragEnd = ({ active, over }: DragEndEvent) => {
        onDraggingChange?.(false);
        if (!over || active.id === over.id) return;
        onChange(moveRule(rules, place(active.id) - 1, place(over.id) - 1));
    };

    const toggle = (id: RuleId, on: boolean) => onChange(rules.map((rule) => (rule.id === id ? { id, on } : rule)));

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
                <span className="font-semibold text-[#A1A1AA] text-[11px] uppercase tracking-[0.06em]">
                    Keep the file with…
                </span>
                <span className="text-[#A1A1AA] text-xs">Drag to reorder · first rule wins</span>
            </div>
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[vertical]}
                // The live region renders in place, inside a dialog around the list, which keeps it audible there.
                accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
                onDragStart={() => onDraggingChange?.(true)}
                onDragEnd={onDragEnd}
                onDragCancel={() => onDraggingChange?.(false)}
            >
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    <ul className="divide-y divide-[#27272A] overflow-hidden rounded-xl border border-[#27272A]">
                        {rules.map((rule, index) => (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                rank={index + 1}
                                onToggle={(on) => toggle(rule.id, on)}
                            />
                        ))}
                    </ul>
                </SortableContext>
            </DndContext>
        </div>
    );
};
