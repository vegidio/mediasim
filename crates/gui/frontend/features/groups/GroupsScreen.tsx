import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaFile } from "@/ipc/thumbs";
import { useScanStore } from "@/stores/scan";
import { useSettingsStore } from "@/stores/settings";
import { AutoSelectDialog } from "./AutoSelectDialog";
import { focusAutoSelectOptions } from "./AutoSelectMenu";
import { leftSummary, resolvedLine, summary, uniqueLine } from "./format";
import { GroupCard, type GroupView } from "./GroupCard";
import { GroupDetailsDialog } from "./GroupDetailsDialog";
import { GroupsFooter } from "./GroupsFooter";
import { GroupsToolbar, useNewComparison } from "./GroupsToolbar";
import { autoSelect, keepBestOnly, markedFiles, pickBest, visibleGroups } from "./marks";
import { stepFlat, stepVertical, type TileBox } from "./navigate";
import type { Rule } from "./rules";

/** A round check mark, a heading, a line, and New comparison, centred in the groups area. */
const Resolved = ({ heading, line }: { heading: string; line: string }) => {
    const newComparison = useNewComparison();

    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/12 text-primary">
                <CheckIcon aria-hidden="true" className="size-[26px]" strokeWidth={2.4} />
            </span>
            <h2 className="font-semibold text-[22px] tracking-[-0.02em]">{heading}</h2>
            <p className="max-w-[440px] text-[#A1A1AA] text-sm leading-normal">{line}</p>
            <Button
                onClick={newComparison}
                className="mt-1.5 h-10 rounded-lg px-[18px] font-semibold text-[#1A2E05] text-sm hover:bg-[#BEF264]/90"
            >
                New comparison
            </Button>
        </div>
    );
};

/** What the groups area shows when the scan found no group: the files compared are unique, and New comparison. */
const NothingSimilar = ({ read, threshold }: { read: number; threshold: number }) => (
    <Resolved heading="No similar files found" line={uniqueLine(read, threshold)} />
);

/** What the groups area shows once removals left no group (8b): every group resolved, and New comparison. */
const NothingLeft = ({ groups, remaining, threshold }: { groups: number; remaining: number; threshold: number }) => (
    <Resolved heading="No similar files left" line={resolvedLine(groups, remaining, threshold)} />
);

/** The group holding the file at `path`, with its number from 1 and its scanned files in the card's order. */
const findShown = (groups: readonly GroupView[], media: ReadonlyMap<string, MediaFile>, path?: string) => {
    if (!path) return;

    const index = groups.findIndex((group) => group.files.some((file) => file.path === path));
    const group = groups[index];
    const file = media.get(path);
    if (!group || !file) return;

    const files = group.files.flatMap((grouped) => media.get(grouped.path) ?? []);
    return { number: index + 1, group, files, file };
};

/** Every tile's thumbnail button, in screen order. */
const thumbnails = () => [...document.querySelectorAll<HTMLElement>("[data-select]")];

/**
 * Focuses the thumbnail of the file at `path`, which selects its tile, and scrolls the groups area to show the whole
 * tile: focusing alone would stop at the thumbnail, leaving its name and details line past the edge.
 */
const focusTile = (path?: string) => {
    const button = thumbnails().find((thumbnail) => thumbnail.dataset.select === path);
    button?.focus({ preventScroll: true });
    button?.closest("[data-path]")?.scrollIntoView({ block: "nearest" });
};

/** Where every tile's thumbnail is on screen now, at the window's current width. */
const measure = () =>
    thumbnails().map((button): TileBox => {
        const { top, bottom, left, right } = button.getBoundingClientRect();
        return { path: button.dataset.select ?? "", top, bottom, left, right };
    });

/**
 * The groups screen (6b/6c): the toolbar with Back, New comparison, the summary and the marking buttons, then the
 * groups of similar files, each with its best file, and the footer with what is marked for deletion; or the "No similar
 * files found" state, or, once removals left no group, the "No similar files left" state (8b). Files removed leave
 * their groups, and a group left with fewer than 2 files leaves the screen. A click on a file's thumbnail selects it,
 * and the arrow keys move the selection; a double click or Enter opens its details (7), over the screen. The best files
 * follow the saved Auto-select rules, which the Auto-select rules dialog (9b) changes and applies.
 */
export const GroupsScreen = () => {
    const result = useScanStore((state) => state.result);
    const heading = useScanStore((state) => state.heading);
    const files = useScanStore((state) => state.files);
    const marks = useScanStore((state) => state.marks);
    const gone = useScanStore((state) => state.gone);
    const toggleMark = useScanStore((state) => state.toggleMark);
    const setMarks = useScanStore((state) => state.setMarks);
    const clearMarks = useScanStore((state) => state.clearMarks);
    const rules = useSettingsStore((state) => state.autoSelectRules);

    const media = useMemo(() => new Map<string, MediaFile>(files.map((file) => [file.path, file])), [files]);
    // The result's groups less the files removed. A change to the rules moves the best files, and leaves the marks to
    // the user.
    const visible = useMemo(() => visibleGroups(result?.groups ?? [], gone), [result, gone]);
    const groups = useMemo(() => pickBest(visible, rules), [visible, rules]);
    const marked = useMemo(() => markedFiles(groups, marks), [groups, marks]);
    // Every group's files in screen order, which ← and → step through.
    const paths = useMemo(() => groups.flatMap((group) => group.files.map((file) => file.path)), [groups]);
    // The selected file's path, whose thumbnail, or else Group 1's first, is the groups area's stop in the tab order.
    const [selected, setSelected] = useState<string>();
    const tabbable = selected ?? paths[0];
    // The path of the file the details show, while they are open, and of the one they last showed, to focus its tile.
    const [shown, setShown] = useState<string>();
    const lastShown = useRef<string>(undefined);
    const details = findShown(groups, media, shown);
    // Whether the Auto-select rules dialog is open.
    const [rulesOpen, setRulesOpen] = useState(false);

    // A selected tile whose file is removed leaves no tile selected.
    useEffect(() => {
        if (selected && gone.has(selected)) setSelected(undefined);
    }, [selected, gone]);

    if (!result || !heading) return null;

    const select = (path?: string) => {
        if (!path) return;
        setSelected(path);
        focusTile(path);
    };

    /** Focuses the selected tile, returning whether one is selected. */
    const refocus = () => {
        if (!selected) return false;
        focusTile(selected);
        return true;
    };

    const applyRules = (rules: Rule[]) => {
        useSettingsStore.getState().update({ autoSelectRules: rules });
        // From the rules themselves, so the marks land in the same render as the badges the memo moves.
        setMarks(autoSelect(pickBest(visible, rules)));
        setRulesOpen(false);
    };

    const onKey = (path: string, event: KeyboardEvent) => {
        switch (event.key) {
            case "ArrowLeft":
            case "ArrowRight":
                select(stepFlat(paths, path, event.key === "ArrowLeft" ? -1 : 1));
                break;
            case "ArrowUp":
            case "ArrowDown":
                select(stepVertical(measure(), path, event.key === "ArrowUp" ? "up" : "down"));
                break;
            case "Enter":
                setShown(path);
                break;
            case " ":
                toggleMark(path);
                break;
            case "Escape":
                setSelected(undefined);
                break;
            default:
                return;
        }
        // Keeps the native button from clicking on Enter and Space, and the groups area from scrolling.
        event.preventDefault();
    };

    const onClick = (event: MouseEvent<HTMLDivElement>) => {
        const { target, currentTarget, nativeEvent } = event;
        // A press on the scrollbar is not a click on the empty space.
        if (target === currentTarget && nativeEvent.offsetX >= currentTarget.clientWidth) return;
        if (target instanceof Element && target.closest("[data-path], button")) return;
        setSelected(undefined);
    };

    const { count: scanned, threshold } = heading;
    const unreadable = result.skipped.length;
    const grouped = groups.reduce((total, group) => total + group.files.length, 0);
    const found = result.groups.length > 0;
    // Every group resolved by removals, rather than none found.
    const nothingLeft = found && groups.length === 0;
    const remaining = scanned - unreadable - gone.size;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <GroupsToolbar
                summary={
                    nothingLeft
                        ? leftSummary({ remaining, threshold, unreadable })
                        : summary({ files: grouped, groups: groups.length, scanned, threshold, unreadable })
                }
                {...(found && {
                    marking: {
                        onClear: clearMarks,
                        onAutoSelect: () => setMarks(autoSelect(groups)),
                        onChooseRules: () => setRulesOpen(true),
                        refocus,
                        ...(nothingLeft && { autoSelectDisabled: true }),
                    },
                })}
            />
            {nothingLeft ? (
                <NothingLeft groups={result.groups.length} remaining={remaining} threshold={threshold} />
            ) : !found ? (
                <NothingSimilar read={scanned - unreadable} threshold={threshold} />
            ) : (
                <>
                    {/* Each tile's thumbnail takes the keys; a click outside every tile clears the selection. */}
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above. */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: see above. */}
                    <div
                        onClick={onClick}
                        className="flex min-h-0 flex-1 flex-wrap content-start gap-4 overflow-y-auto p-6"
                    >
                        {groups.map((group, index) => (
                            <GroupCard
                                key={group.files[0]?.path}
                                number={index + 1}
                                group={group}
                                media={media}
                                marks={marks}
                                onToggle={toggleMark}
                                onKeepBestOnly={() => setMarks(keepBestOnly(marks, group))}
                                {...(selected && { selected })}
                                {...(tabbable && { tabbable })}
                                onSelect={setSelected}
                                onOpen={setShown}
                                onKey={onKey}
                            />
                        ))}
                    </div>
                    <AutoSelectDialog
                        open={rulesOpen}
                        groups={visible}
                        onApply={applyRules}
                        onClose={() => setRulesOpen(false)}
                        onClosed={() => refocus() || focusAutoSelectOptions()}
                    />
                    {details && (
                        <GroupDetailsDialog
                            {...details}
                            onShow={setShown}
                            onClose={() => {
                                lastShown.current = shown;
                                setSelected(shown);
                                setShown(undefined);
                            }}
                            onClosed={() => focusTile(lastShown.current)}
                        />
                    )}
                </>
            )}
            {found && <GroupsFooter marked={marked} media={media} />}
        </div>
    );
};
