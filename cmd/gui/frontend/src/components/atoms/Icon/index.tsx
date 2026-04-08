import type { ComponentType } from 'react';
import {
    MdAdd,
    MdAutoFixHigh,
    MdCheckBox,
    MdCheckBoxOutlineBlank,
    MdCheckCircleOutline,
    MdChevronLeft,
    MdClose,
    MdCompare,
    MdDeleteOutline,
    MdImage,
    MdRemove,
    MdVideocam,
} from 'react-icons/md';
import { PiImageDuotone } from 'react-icons/pi';

const icons = {
    'auto-mark': MdAutoFixHigh,
    mark: MdCheckCircleOutline,
    delete: MdDeleteOutline,
    close: MdClose,
    compare: MdCompare,
    back: MdChevronLeft,
    'zoom-in': MdAdd,
    'zoom-out': MdRemove,
    checked: MdCheckBox,
    unchecked: MdCheckBoxOutlineBlank,
    image: MdImage,
    video: MdVideocam,
    logo: PiImageDuotone,
} satisfies Record<string, ComponentType<{ size?: number; className?: string }>>;

type IconName = keyof typeof icons;

type IconProps = {
    name: IconName;
    size?: number;
    className?: string;
};

export const Icon = ({ name, size, className }: IconProps) => {
    const Component = icons[name];
    return <Component size={size} className={className} />;
};
