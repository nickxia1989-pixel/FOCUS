// 图标：24 网格、2px 描边，取自设计交接包 design_handoff_focus/icons
import type { ReactElement, SVGProps } from 'react';
import type { ListId, ViewId } from '../types';

type P = SVGProps<SVGSVGElement>;

const line = (p: P, sw = 2) => ({
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

const SPARK = 'M12 2.8c.8 5 3.4 7.6 8.4 8.4-5 .8-7.6 3.4-8.4 8.4-.8-5-3.4-7.6-8.4-8.4 5-.8 7.6-3.4 8.4-8.4z';
const CLOUD = 'M7.2 18.5h9.9a4 4 0 0 0 .5-7.97 5.6 5.6 0 0 0-10.8-1A4.5 4.5 0 0 0 7.2 18.5z';

/** 星芒：FOCUS */
export const SparkIcon = (p: P) => (
  <svg {...line(p)}>
    <path d={SPARK} />
  </svg>
);

export const SparkFilledIcon = (p: P) => (
  <svg {...line(p)} fill="currentColor" stroke="none">
    <path d={SPARK} />
  </svg>
);

/** 眼睛里一个勾：VERIFY（再看一眼） */
export const EyeCheckIcon = (p: P) => (
  <svg {...line(p)}>
    <path d="M2.4 12S6 5.4 12 5.4 21.6 12 21.6 12 18 18.6 12 18.6 2.4 12 2.4 12z" />
    <path d="m9.4 12.1 1.8 1.8 3.4-3.6" />
  </svg>
);

export const InboxIcon = (p: P) => (
  <svg {...line(p)}>
    <path d="M3.5 13.5 6 6a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 6l2.5 7.5V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <path d="M3.5 13.5h4.6l1.4 2.4h5l1.4-2.4h4.6" />
  </svg>
);

/** 山：GOAL */
export const GoalIcon = (p: P) => (
  <svg {...line(p)}>
    <path d="M2.8 19.6 9.4 7.8l3.9 6.4 2.4-3.3 5.5 8.7z" />
  </svg>
);

/** 带勾的日历：HISTORY */
export const HistoryIcon = (p: P) => (
  <svg {...line(p)}>
    <rect x="3.8" y="5" width="16.4" height="15.2" rx="3.2" />
    <path d="M8 3v4M16 3v4M3.8 10h16.4M9 15l2 2 4-4" />
  </svg>
);

export const ListIcons: Record<ListId, (p: P) => ReactElement> = {
  focus: SparkIcon,
  verify: EyeCheckIcon,
  inbox: InboxIcon,
  goal: GoalIcon,
};

export const ViewIcons: Record<ViewId, (p: P) => ReactElement> = { ...ListIcons, history: HistoryIcon };

export const PlusIcon = (p: P) => (
  <svg {...line(p, 2.2)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MoreIcon = (p: P) => (
  <svg {...line(p)} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18.5" cy="12" r="1.8" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...line(p, 3)}>
    <path d="m5 12.5 4.3 4.3L19 7.2" />
  </svg>
);

export const ChevronIcon = (p: P) => (
  <svg {...line(p, 2.2)}>
    <path d="m7 10 5 5 5-5" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg {...line(p, 2.2)}>
    <path d="m10 7 5 5-5 5" />
  </svg>
);

export const BackIcon = (p: P) => (
  <svg {...line(p, 2.2)}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);

/** 设为现在 */
export const UpIcon = (p: P) => (
  <svg {...line(p)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

/** 移出聚焦区 */
export const DownIcon = (p: P) => (
  <svg {...line(p)}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2A1.8 1.8 0 0 0 9.2 21h5.6a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
  </svg>
);

export const EditIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);

export const SubtaskIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M6 4v9a3 3 0 0 0 3 3h9M15 13l3 3-3 3" />
  </svg>
);

/** 升一级（反缩进） */
export const OutdentIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M20 6H10M20 12h-8M20 18H10M7.5 9 4.5 12l3 3" />
  </svg>
);

/** 外观（半月） */
export const ThemeIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />
  </svg>
);

/** 键盘（快捷键） */
export const KeyboardIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <rect x="3" y="6" width="18" height="12" rx="2.4" />
    <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </svg>
);

export const MoveIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M4 12h14M13 6l6 6-6 6" />
  </svg>
);

export const SoundIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export const FolderIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

export const SwapIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M7 4 4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8" />
  </svg>
);

/** 恢复 / 撤销 */
export const UndoIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <path d="M8.5 5.5 4.5 9.5l4 4M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" />
  </svg>
);

export const GripIcon = (p: P) => (
  <svg viewBox="0 0 8 14" width={8} height={14} fill="currentColor" aria-hidden {...p}>
    <circle cx="2" cy="2" r="1.3" />
    <circle cx="6" cy="2" r="1.3" />
    <circle cx="2" cy="7" r="1.3" />
    <circle cx="6" cy="7" r="1.3" />
    <circle cx="2" cy="12" r="1.3" />
    <circle cx="6" cy="12" r="1.3" />
  </svg>
);

export const LaptopIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <rect x="4.5" y="5" width="15" height="10.5" rx="1.6" />
    <path d="M2.5 19h19" />
  </svg>
);

export const PhoneIcon = (p: P) => (
  <svg {...line(p, 1.9)}>
    <rect x="7" y="3" width="10" height="18" rx="2.4" />
    <path d="M11 18h2" />
  </svg>
);

export const PinIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...line(p, 1.9)}>
    <path d="M9 3.5h6l-1 5.2 3 3.1v1.7H7v-1.7l3-3.1z" fill={filled ? 'currentColor' : 'none'} />
    <path d="M12 13.5V20.5" />
  </svg>
);

/** Windows 标题栏：最小化 / 关闭（10 网格、1px） */
export const MinimizeIcon = (p: P) => (
  <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1} aria-hidden {...p}>
    <path d="M0 5h10" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1} aria-hidden {...p}>
    <path d="M0 0l10 10M10 0 0 10" />
  </svg>
);

export const CloseLineIcon = (p: P) => (
  <svg {...line(p, 2.2)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

// ---------- 同步状态（云朵） ----------

export type CloudState = 'ok' | 'syncing' | 'offline' | 'error' | 'conflict' | 'off';

export const CloudStateIcon = ({ state, ...p }: P & { state: CloudState }) => {
  if (state === 'syncing')
    return (
      <svg {...line(p)}>
        <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" />
        <path d="M17.8 3.6v3.6h-3.6M6.2 20.4v-3.6h3.6" />
      </svg>
    );
  if (state === 'offline')
    return (
      <svg {...line(p, 1.9)}>
        <path d="M7.2 18.5h9.9a4 4 0 0 0 1.6-.33M20.4 15a4 4 0 0 0-2.8-4.47 5.6 5.6 0 0 0-8.3-3.9M6.2 9.2A4.5 4.5 0 0 0 7.2 18.5" />
        <path d="M3.5 3.5l17 17" />
      </svg>
    );
  return (
    <svg {...line(p, 1.9)}>
      <path d={CLOUD} strokeDasharray={state === 'off' ? '2.4 2.6' : undefined} />
      {state === 'ok' && <path d="m9.6 13.9 1.8 1.8 3.2-3.4" />}
      {state === 'error' && (
        <>
          <path d="M12 10.5v3.2" />
          <circle cx="12" cy="16" r=".5" fill="currentColor" />
        </>
      )}
      {state === 'conflict' && <path d="M10 12.2l1.4 1.4-1.4 1.4M14 12.2l-1.4 1.4 1.4 1.4" />}
    </svg>
  );
};

/** Windows 标题栏左侧的应用图标（同 icons/app-icon-windows.svg） */
export const AppGlyph = (p: P) => (
  <svg viewBox="0 0 132 132" width={16} height={16} aria-hidden {...p}>
    <rect width="132" height="132" rx="16" fill="#0B0B0C" />
    <rect x="34" y="94" width="64" height="16" rx="7" fill="#2A2A2D" />
    <rect x="27" y="84" width="78" height="17" rx="8" fill="#45454A" />
    <rect x="20" y="20" width="92" height="70" rx="17" fill="#D6FF3D" />
    <path transform="translate(66 55) scale(1.95) translate(-12 -11.2)" d={SPARK} fill="#0B0B0C" />
  </svg>
);
