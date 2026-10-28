import type { SVGProps } from 'react';

export type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;
