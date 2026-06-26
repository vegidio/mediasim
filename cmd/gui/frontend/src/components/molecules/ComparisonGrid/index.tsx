import { useMemo, useRef } from 'react';
import type { ComparisonMedia } from '@bindings/gui/services/models.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { basename } from 'pathe';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useComparisonStore, useImagesStore } from '@/stores';
import { GRID_PADDING, TILE_GAP } from '@/utils/constants';
import { useContainerWidth } from '@/utils/useContainerWidth';

type Row = { type: 'header'; groupIndex: number } | { type: 'tiles'; media: ComparisonMedia[] };

export const ComparisonGrid = () => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const groups = useComparisonStore((s) => s.groups);
    const images = useImagesStore((s) => s.images);
    const tileSize = useAppStore((s) => s.tileSize);

    const width = useContainerWidth(scrollRef);
    const columns = Math.max(1, Math.floor((width - 2 * GRID_PADDING + TILE_GAP) / (tileSize + TILE_GAP)));

    const modTimeByPath = useMemo(() => new Map(images.map((img) => [img.path, img.modTime])), [images]);

    const rows = useMemo<Row[]>(() => {
        if (!groups) return [];

        const result: Row[] = [];
        groups.forEach((group, groupIndex) => {
            result.push({ type: 'header', groupIndex });
            for (let i = 0; i < group.media.length; i += columns) {
                result.push({ type: 'tiles', media: group.media.slice(i, i + columns) });
            }
        });
        return result;
    }, [groups, columns]);

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => tileSize + 52 + TILE_GAP,
        overscan: 3,
    });

    if (!groups) return undefined;

    return (
        <div ref={scrollRef} className='overflow-y-auto h-full p-4'>
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];

                    return (
                        <div
                            key={virtualRow.key}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            {row.type === 'header' ? (
                                <h3
                                    style={{ paddingTop: row.groupIndex > 0 ? 24 : 0 }}
                                    className='text-sm font-medium text-gray-300 pb-2'
                                >
                                    Group {row.groupIndex + 1}
                                </h3>
                            ) : (
                                <div
                                    style={{
                                        gridTemplateColumns: `repeat(${columns}, ${tileSize}px)`,
                                        gap: TILE_GAP,
                                        paddingBottom: TILE_GAP,
                                    }}
                                    className='grid'
                                >
                                    {row.media.map((media) => (
                                        <ImageTile
                                            key={media.path}
                                            path={media.path}
                                            filename={basename(media.path)}
                                            size={tileSize}
                                            modTime={modTimeByPath.get(media.path)}
                                            fileSize={media.size}
                                            length={media.length}
                                            scrollRef={scrollRef}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
