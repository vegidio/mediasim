import { useRef } from 'react';
import { basename } from 'pathe';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useComparisonStore, useImagesStore } from '@/stores';
import { TILE_GAP } from '@/utils/constants';

export const ComparisonGrid = () => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const groups = useComparisonStore((s) => s.groups);
    const images = useImagesStore((s) => s.images);
    const tileSize = useAppStore((s) => s.tileSize);

    if (!groups) return undefined;

    return (
        <div ref={scrollRef} className='overflow-y-auto h-full p-4'>
            {groups.map((group, index) => (
                <div key={index} className='mb-6'>
                    <h3 className='text-sm font-medium text-gray-300 mb-2'>Group {index + 1}</h3>

                    <div
                        style={{ gridTemplateColumns: `repeat(auto-fill, ${tileSize}px)`, gap: TILE_GAP }}
                        className='grid'
                    >
                        {group.media.map((media) => {
                            const cached = images.find((img) => img.path === media.path);

                            return (
                                <ImageTile
                                    key={media.path}
                                    path={media.path}
                                    filename={basename(media.path)}
                                    status={cached?.status ?? 'idle'}
                                    size={tileSize}
                                    modTime={cached?.modTime}
                                    fileSize={media.size}
                                    length={media.length}
                                    scrollRef={scrollRef}
                                />
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};
