import { useEffect, useRef } from 'react';
import { ListMedia } from '@bindings/gui/services/mediaservice';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useImagesStore, useSelectionStore } from '@/stores';
import { GRID_PADDING, TILE_GAP } from '@/utils/constants';
import { useContainerWidth } from '@/utils/useContainerWidth';

export const ImageGrid = () => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
    const tileSize = useAppStore((s) => s.tileSize);
    const images = useImagesStore((s) => s.images);
    const setImages = useImagesStore((s) => s.setImages);
    const clearSelection = useSelectionStore((s) => s.clear);

    const width = useContainerWidth(scrollRef);
    const columns = Math.max(1, Math.floor((width - 2 * GRID_PADDING + TILE_GAP) / (tileSize + TILE_GAP)));
    const rowCount = Math.ceil(images.length / columns);

    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => tileSize + 52 + TILE_GAP,
        overscan: 3,
    });

    useEffect(() => {
        if (!selectedDirectory) return;

        clearSelection();
        ListMedia(selectedDirectory).then((mediaInfos) => {
            setImages(mediaInfos);
        });
    }, [selectedDirectory, setImages, clearSelection]);

    return (
        <div ref={scrollRef} className='overflow-y-auto h-full p-4'>
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const start = virtualRow.index * columns;
                    const rowItems = images.slice(start, start + columns);

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
                            <div
                                style={{
                                    gridTemplateColumns: `repeat(${columns}, ${tileSize}px)`,
                                    gap: TILE_GAP,
                                    paddingBottom: TILE_GAP,
                                }}
                                className='grid justify-center'
                            >
                                {rowItems.map((entry) => (
                                    <ImageTile
                                        key={entry.path}
                                        path={entry.path}
                                        filename={entry.filename}
                                        size={tileSize}
                                        modTime={entry.modTime}
                                        fileSize={entry.fileSize}
                                        scrollRef={scrollRef}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
