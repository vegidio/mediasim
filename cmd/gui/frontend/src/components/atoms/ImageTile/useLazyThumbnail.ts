import { type RefObject, useEffect } from 'react';
import { GetDimensions } from '@bindings/gui/services/thumbnailservice.js';
import { useAppStore, useImagesStore } from '@/stores';
import { getCachedThumbnail } from '@/utils/thumbnailCache';

export const useLazyThumbnail = (
    ref: RefObject<HTMLDivElement | null>,
    path: string,
    status: 'idle' | 'loading' | 'loaded',
    scrollRef?: RefObject<HTMLDivElement | null>,
) => {
    const tileSize = useAppStore((s) => s.tileSize);
    const setLoading = useImagesStore((s) => s.setLoading);
    const setThumbnailLoaded = useImagesStore((s) => s.setThumbnailLoaded);

    useEffect(() => {
        if (!ref.current || status !== 'idle') return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();
                    setLoading(path);

                    const url = `/thumb?path=${encodeURIComponent(path)}&maxSize=${tileSize}`;

                    GetDimensions(path).then(([w, h]) => setThumbnailLoaded(path, url, w, h));
                }
            },
            { threshold: 0.1, rootMargin: '500px', root: scrollRef?.current ?? null },
        );

        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [path, status, tileSize, setLoading, setThumbnailLoaded, ref.current, scrollRef?.current]);

    return status === 'loaded' ? getCachedThumbnail(path) : undefined;
};
