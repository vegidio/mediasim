import { useEffect } from 'react';
import { ListMedia } from '@bindings/gui/services/mediaservice';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useImagesStore, useSelectionStore } from '@/stores';

export const ImageGrid = () => {
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
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
            <div className='grid grid-cols-[repeat(auto-fill,180px)] gap-4 justify-center'>
                {images.map((entry) => (
                    <ImageTile
                        key={entry.path}
                        path={entry.path}
                        filename={entry.filename}
                        status={entry.status}
                        modTime={entry.modTime}
                        fileSize={entry.fileSize}
                    />
                ))}
            </div>
        </div>
    );
};
