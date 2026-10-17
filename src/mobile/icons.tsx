// iOS 版图标：24 网格、圆头描边，接近 SF Symbols 的观感
import type { JSX, SVGProps } from 'react';
import type { Section } from './data';

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

/** 靶心：FOCUS */
export const TargetIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
  </svg>
);

/** 烧瓶：VERIFY / 待测 */
export const FlaskIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.7 3.6h6.6M9.9 3.8v5.5l-5.1 8.6a1.6 1.6 0 0 0 1.4 2.4h11.6a1.6 1.6 0 0 0 1.4-2.4l-5.1-8.6V3.8" />
    <path d="M6.9 14.4h10.2" />
  </svg>
);

export const InboxIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.8 14.2 6.2 6.5a1.6 1.6 0 0 1 1.5-1.1h8.6a1.6 1.6 0 0 1 1.5 1.1l2.4 7.7v3.9a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6z" />
    <path d="M3.8 14.2h4.6l1.2 2.2h4.8l1.2-2.2h4.6" />
  </svg>
);

export const FlagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 20.5V4.2M6 4.5h11.2l-2.7 3.9 2.7 3.9H6" />
  </svg>
);

/** 日历里打勾：HISTORY */
export const HistoryIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.8" y="5" width="16.4" height="15" rx="3" />
    <path d="M3.8 9.6h16.4M8.2 3.3v3.2M15.8 3.3v3.2M9 14.6l2.1 2.1 4-4.2" />
  </svg>
);

export const SectionIcons: Record<Section, (p: P) => JSX.Element> = {
  focus: TargetIcon,
  verify: FlaskIcon,
  inbox: InboxIcon,
  goal: FlagIcon,
  history: HistoryIcon,
};

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MoreIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18.5" cy="12" r="1.8" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5.5 12.5 4.2 4.2 8.8-9.4" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m7 9.5 5 5 5-5" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6.8h15M9.6 6.8V4.6h4.8v2.2M6.6 6.8l.9 12a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12M10.2 10.8v5.6M13.8 10.8v5.6" />
  </svg>
);

export const EditIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m4.5 19.5 1-4 10.3-10.3a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.5 18.5zM14.3 6.7l3 3" />
  </svg>
);

export const SubtaskIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4.5v9a2.5 2.5 0 0 0 2.5 2.5h4.5M17 12.5v7M13.5 16h7" />
  </svg>
);

export const MoveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13.5 5.5h3.8a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2h-3.8M4.5 12h10.5M11.5 8.5 15 12l-3.5 3.5" />
  </svg>
);

export const RestoreIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 6 4.5 9.5 8 13M4.5 9.5h9.8a5 5 0 0 1 0 10H10" />
  </svg>
);

export const UncheckIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="m8.6 8.6 6.8 6.8" />
  </svg>
);

export const ArrowUpIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <path d="M12 18.5V6M6.8 11 12 5.8l5.2 5.2" />
  </svg>
);

export const SoundIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 9.5v5h3.4l4.6 3.8V5.7L7.9 9.5zM15.8 9a4 4 0 0 1 0 6M18.4 6.5a7.6 7.6 0 0 1 0 11" />
  </svg>
);

export const HapticIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="3.8" width="8" height="16.4" rx="2.2" />
    <path d="M4.6 8.5v7M19.4 8.5v7M2.4 10.5v3M21.6 10.5v3" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </svg>
);

export const SparkIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="m12 2.5 2.2 6.6 6.8 2.4-6.8 2.4L12 20.5l-2.2-6.6L3 11.5l6.8-2.4z" />
  </svg>
);

export const SwapIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 4.5 4 7.5l3 3M4 7.5h12.5M17 13.5l3 3-3 3M20 16.5H7.5" />
  </svg>
);
