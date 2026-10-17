import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const MoreIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </svg>
);

/** 靶心：代表 FOCUS */
export const TargetIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="2.3" fill="currentColor" stroke="none" />
  </svg>
);

export const InboxIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 9.5l1.6-5.2a1 1 0 0 1 1-.7h5.8a1 1 0 0 1 1 .7l1.6 5.2v2.6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1z" />
    <path d="M2.5 9.5h3l.8 1.5h3.4l.8-1.5h3" />
  </svg>
);

export const FlagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 14V2.8M4 3h7.5l-1.8 2.6L11.5 8H4" />
  </svg>
);

/** 烧瓶：代表待测 */
export const FlaskIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.8 2.5h4.4M6.6 2.6v3.7L3.2 12a1.1 1.1 0 0 0 .95 1.6h7.7a1.1 1.1 0 0 0 .95-1.6L9.4 6.3V2.6" />
    <path d="M4.6 9.6h6.8" />
  </svg>
);

export const ListIcons = { focus: TargetIcon, verify: FlaskIcon, inbox: InboxIcon, goal: FlagIcon };

export const ChevronIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6.2L8 9.8l3.5-3.6" />
  </svg>
);

export const PinIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2.5h4M6.6 2.7l-.5 4.2-2.1 2.2h8l-2.1-2.2-.5-4.2M8 9.1v4.4" />
  </svg>
);

export const MinimizeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8h9" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.2" />
  </svg>
);

export const EditIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 13l.6-2.6 7-7a1.4 1.4 0 0 1 2 2l-7 7z" />
  </svg>
);

export const SubtaskIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 3v6.5a1.5 1.5 0 0 0 1.5 1.5H9M11 8.5v5M8.5 11h5" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8.3l3 3 6-6.6" />
  </svg>
);

export const BackIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9.8 3.5L5.3 8l4.5 4.5" />
  </svg>
);

export const UndoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 4L3 6.5 5.5 9M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" />
  </svg>
);

export const SparkIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 1.5l1.5 4.4 4.5 1.6-4.5 1.6L8 13.5 6.5 9.1 2 7.5l4.5-1.6z" />
  </svg>
);

/** 带勾的日历：代表完成记录 */
export const HistoryIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.3" width="11" height="10.2" rx="2" />
    <path d="M2.5 6.6h11M5.5 2v2.4M10.5 2v2.4" />
    <path d="M6 10.1l1.4 1.3 2.7-2.8" />
  </svg>
);

/** 云：同步状态 */
export const CloudIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.6 12.6h7.2a2.9 2.9 0 0 0 .4-5.77 4.1 4.1 0 0 0-7.9-.6A3.2 3.2 0 0 0 4.6 12.6z" />
  </svg>
);

export const CloudOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6.2 4.4a4.1 4.1 0 0 1 6 2.43 2.9 2.9 0 0 1 1.6 4.9M11 12.6H4.6a3.2 3.2 0 0 1-.42-6.37" />
    <path d="M2.5 2.5l11 11" />
  </svg>
);

export const SyncIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 6.5A5 5 0 0 0 4.1 4.6L3 5.8M3 2.8v3h3M3 9.5a5 5 0 0 0 8.9 1.9l1.1-1.2M13 13.2v-3h-3" />
  </svg>
);

export const AlertIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2.5l6 10.5H2z" />
    <path d="M8 6.6v3M8 11.4v.1" />
  </svg>
);
