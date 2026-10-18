// iOS 版图标：照设计交接包 design_handoff_focus/icons/*.svg（24 网格、圆头描边）
import type { JSX, SVGProps } from 'react';
import type { Section } from './data';

type P = SVGProps<SVGSVGElement>;

const base = (p: P, strokeWidth = 1.9) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

const SPARK = 'M12 2.8c.8 5 3.4 7.6 8.4 8.4-5 .8-7.6 3.4-8.4 8.4-.8-5-3.4-7.6-8.4-8.4 5-.8 7.6-3.4 8.4-8.4z';

/** 星芒：FOCUS */
export const SparkIcon = (p: P) => (
  <svg {...base(p, 2)}>
    <path d={SPARK} />
  </svg>
);

/** 实心星芒：完成时迸出的火花、FOCUS 选中 */
export const SparkFilledIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d={SPARK} />
  </svg>
);

/** 眼睛里一个勾：VERIFY / 送去验证 */
export const EyeCheckIcon = (p: P) => (
  <svg {...base(p, 2)}>
    <path d="M2.4 12S6 5.4 12 5.4 21.6 12 21.6 12 18 18.6 12 18.6 2.4 12 2.4 12z" />
    <path d="m9.4 12.1 1.8 1.8 3.4-3.6" />
  </svg>
);

export const InboxIcon = (p: P) => (
  <svg {...base(p, 2)}>
    <path d="M3.5 13.5 6 6a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 6l2.5 7.5V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <path d="M3.5 13.5h4.6l1.4 2.4h5l1.4-2.4h4.6" />
  </svg>
);

/** 山：GOAL */
export const GoalIcon = (p: P) => (
  <svg {...base(p, 2)}>
    <path d="M2.8 19.6 9.4 7.8l3.9 6.4 2.4-3.3 5.5 8.7z" />
  </svg>
);

export const HistoryIcon = (p: P) => (
  <svg {...base(p, 2)}>
    <rect x="3.8" y="5" width="16.4" height="15.2" rx="3.2" />
    <path d="M8 3v4M16 3v4M3.8 10h16.4M9 15l2 2 4-4" />
  </svg>
);

export const SectionIcons: Record<Section, (p: P) => JSX.Element> = {
  focus: SparkIcon,
  verify: EyeCheckIcon,
  inbox: InboxIcon,
  goal: GoalIcon,
  history: HistoryIcon,
};

export const PlusIcon = (p: P) => (
  <svg {...base(p, 2.2)}>
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
  <svg {...base(p, 3)}>
    <path d="m5 12.5 4.3 4.3L19 7.2" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p, 2.2)}>
    <path d="m7 10 5 5 5-5" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg {...base(p, 2.2)}>
    <path d="m10 7 5 5-5 5" />
  </svg>
);

export const BackIcon = (p: P) => (
  <svg {...base(p, 2.2)}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2A1.8 1.8 0 0 0 9.2 21h5.6a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
  </svg>
);

export const EditIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);

export const SubtaskIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 4v9a3 3 0 0 0 3 3h9M15 13l3 3-3 3" />
  </svg>
);

export const MoveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12h14M13 6l6 6-6 6" />
  </svg>
);

/** 设为现在 */
export const UpIcon = (p: P) => (
  <svg {...base(p, 2.2)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const ArrowUpIcon = UpIcon;

export const DownIcon = (p: P) => (
  <svg {...base(p, 2.2)}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

/** 缩进：挂到上一条下面 */
export const IndentIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 6h9M11 12h9M11 18h9M4 9l3 3-3 3" />
  </svg>
);

/** 反缩进：升一级 */
export const OutdentIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 6h9M11 12h9M11 18h9M7 9l-3 3 3 3" />
  </svg>
);

/** 外观：半边填满的圆 */
export const AppearanceIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 3.8a8.2 8.2 0 0 0 0 16.4z" fill="currentColor" stroke="none" />
  </svg>
);

export const RestoreIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
    <path d="M4 4v4.6h4.6" />
  </svg>
);

export const UncheckIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.2" strokeDasharray="3 3" />
  </svg>
);

export const SoundIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export const HapticIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="3.5" width="8" height="17" rx="2" />
    <path d="M4.5 8v8M19.5 8v8M2 10.5v3M22 10.5v3" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p, 2.4)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** 空间（多个人） */
export const SpacesIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
    <circle cx="17" cy="9.5" r="2.5" />
    <path d="M17.5 14.5c2 .3 3.2 1.8 3.6 4" />
  </svg>
);

export const SwapIcon = SpacesIcon;

const CLOUD = 'M7.2 18.5h9.9a4 4 0 0 0 .5-7.97 5.6 5.6 0 0 0-10.8-1A4.5 4.5 0 0 0 7.2 18.5z';

/** 已同步：带勾的云朵 */
export const CloudIcon = (p: P) => (
  <svg {...base(p)}>
    <path d={CLOUD} />
    <path d="m9.6 13.9 1.8 1.8 3.2-3.4" />
  </svg>
);

/** 离线：斜线云朵 */
export const CloudOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7.2 18.5h9.9a4 4 0 0 0 1.6-.33M20.4 15a4 4 0 0 0-2.8-4.47 5.6 5.6 0 0 0-8.3-3.9M6.2 9.2A4.5 4.5 0 0 0 7.2 18.5" />
    <path d="M3.5 3.5l17 17" />
  </svg>
);

/** 出错：带感叹号的云朵 */
export const CloudErrorIcon = (p: P) => (
  <svg {...base(p)}>
    <path d={CLOUD} />
    <path d="M12 10.5v3.2" />
    <circle cx="12" cy="16" r=".5" fill="currentColor" />
  </svg>
);

/** 未开启：虚线云朵 */
export const CloudDashedIcon = (p: P) => (
  <svg {...base(p)}>
    <path d={CLOUD} strokeDasharray="2.4 2.6" />
  </svg>
);

/** 同步中：双箭头 */
export const SyncIcon = (p: P) => (
  <svg {...base(p, 2)}>
    <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" />
    <path d="M17.8 3.6v3.6h-3.6M6.2 20.4v-3.6h3.6" />
  </svg>
);

export const PhoneIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="7" y="3" width="10" height="18" rx="2.4" />
    <path d="M11 18h2" />
  </svg>
);

export const LaptopIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4.5" y="5" width="15" height="10.5" rx="1.6" />
    <path d="M2.5 19h19" />
  </svg>
);

// 旧名字：别处还在用
export const TargetIcon = SparkIcon;
export const FlaskIcon = EyeCheckIcon;
export const FlagIcon = GoalIcon;
