import { useState } from 'react';
import { IconButton, Slider } from '@mui/material';
import { MdAdd, MdRemove } from 'react-icons/md';

export const TileSlider = () => {
    const [size, setSize] = useState(1);

    const handleTileChange = (_: Event, value: number | number[]) => {
        setSize(value as number);
    };

    const handleZoomIn = () => {
        setSize((prev) => Math.min(prev + 0.5, 8));
    };

    const handleZoomOut = () => {
        setSize((prev) => Math.max(prev - 0.5, 1));
    };

    return (
        <div className='flex items-center gap-1'>
            <IconButton color='inherit' size='small' onClick={handleZoomOut}>
                <MdRemove />
            </IconButton>

            <Slider
                className='w-32'
                size='small'
                min={180}
                max={360}
                step={10}
                value={size}
                onChange={handleTileChange}
            />

            <IconButton color='inherit' size='small' onClick={handleZoomIn}>
                <MdAdd />
            </IconButton>
        </div>
    );
};
