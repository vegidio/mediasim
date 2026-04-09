import { useEffect } from 'react';
import { ListMedia } from '@bindings/gui/services/mediaservice';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useImagesStore, useSelectionStore } from '@/stores';
import { TILE_GAP } from '@/utils/constants';

export const ImageGrid = () => {
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
    const tileSize = useAppStore((s) => s.tileSize);
    const images = useImagesStore((s) => s.images);
    const setImages = useImagesStore((s) => s.setImages);
    const clearSelection = useSelectionStore((s) => s.clear);

    useEffect(() => {
        if (!selectedDirectory) return;

        clearSelection();
        ListMedia(selectedDirectory).then((mediaInfos) => {
            setImages(mediaInfos);
        });
    }, [selectedDirectory, setImages, clearSelection]);

    return (
        <div className='overflow-y-auto h-full p-4'>
            <div
                style={{ gridTemplateColumns: `repeat(auto-fill, ${tileSize}px)`, gap: TILE_GAP }}
                className='grid justify-center'
            >
                {images.map((entry) => (
                    <ImageTile
                        key={entry.path}
                        path={entry.path}
                        filename={entry.filename}
                        status={entry.status}
                        size={tileSize}
                        modTime={entry.modTime}
                        fileSize={entry.fileSize}
                    />
                ))}
            </div>
        </div>
    );
};
