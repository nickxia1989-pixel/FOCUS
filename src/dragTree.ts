// 自由拖拽的落点算法（桌面和 iOS 共用，纯函数，不碰界面）。
//
// 界面把当前看得见的行按显示顺序摊平成 DragRow[]（每行带深度），拖动时：
// 1. 被拖的那一项连同子孙从行里拿掉（restRows），剩下的行之间有 rest.length + 1 个空隙；
// 2. 手指 / 鼠标的纵坐标决定落在哪个空隙（gap：0 = 第一行上面，rest.length = 最后一行下面）；
// 3. 横坐标决定深度：想要的深度 = 开始拖时的深度 + 横向位移 / 每级缩进（四舍五入）；
// 4. projectDrop 把深度夹在这个空隙允许的范围里，算出新的父项和在兄弟里的位置。
//
// 空隙允许的深度：
// - 最深 = 上一行的深度 + 1（成为上一行的子项）；第一个空隙只能是 0；
// - 最浅 = 下一行的深度（不然下一行会「换父亲」）；最后一个空隙最浅是 0。
// 所以子子项可以往左拖成子项、顶层，外面的项可以往右拖进某一行下面，在一棵树的任何位置之间随便挪。
//
// 落点交给 model.placeTodo（store.place）执行；跨列表（拖到侧栏 / 页签上）不走这里。
import type { PlaceTarget } from './model';
import type { ListId } from './types';

/** 最多几层（顶层是 0）。再深在手机上就没法看了 */
export const MAX_DEPTH = 8;

export interface DragRow {
  id: string;
  depth: number;
  parentId: string | null;
  list: ListId;
  done: boolean;
  /** 有子项但折叠着（子项不在行里）。落到它下面一级时排到它子项的最后 */
  collapsed?: boolean;
}

/** 拿掉被拖的那一项和它的子孙（它们在行里紧跟着它，深度都比它大） */
export function restRows(rows: DragRow[], activeId: string): DragRow[] {
  const i = rows.findIndex((r) => r.id === activeId);
  if (i < 0) return rows;
  let j = i + 1;
  while (j < rows.length && rows[j].depth > rows[i].depth) j++;
  return [...rows.slice(0, i), ...rows.slice(j)];
}

/** 被拖的那一项原来在 rest 里的空隙位置（没动时 projectDrop 会算回原位） */
export function originGap(rows: DragRow[], activeId: string): number {
  return Math.max(0, rows.findIndex((r) => r.id === activeId));
}

/** 这个空隙允许的深度范围 */
export function depthRange(rest: DragRow[], gap: number): { min: number; max: number } {
  const prev = rest[gap - 1];
  const next = rest[gap];
  const max = prev ? Math.min(prev.depth + 1, MAX_DEPTH) : 0;
  const min = next ? Math.min(next.depth, max) : 0;
  return { min, max };
}

export interface DropProjection extends PlaceTarget {
  /** 夹过之后的深度，画插入线的缩进用 */
  depth: number;
  /** 插入线画在哪一行下面（null = 最上面） */
  afterId: string | null;
  /** 新父项（顶层为 null），界面可以给它加个高亮 */
  parentId: string | null;
  /** 落回原处，不用改数据 */
  unchanged: boolean;
}

/**
 * 算落点。rows：完整的可见行（含被拖的那一项）；gap：在 restRows 里的空隙；
 * wantDepth：界面按横向位移算出的想要的深度。被拖的那一项不在 rows 里时返回 null。
 */
export function projectDrop(rows: DragRow[], activeId: string, gap: number, wantDepth: number): DropProjection | null {
  const active = rows.find((r) => r.id === activeId);
  if (!active) return null;
  const rest = restRows(rows, activeId);
  const g = Math.max(0, Math.min(gap, rest.length));
  const { min, max } = depthRange(rest, g);
  const depth = Math.max(min, Math.min(max, Math.round(wantDepth)));

  // 父项：往上找第一行深度 = depth - 1 的
  let parent: DragRow | null = null;
  if (depth > 0) {
    for (let k = g - 1; k >= 0; k--) {
      if (rest[k].depth === depth - 1) {
        parent = rest[k];
        break;
      }
      if (rest[k].depth < depth - 1) break;
    }
    if (!parent) return null; // 行不规整（不该发生）
  }
  const parentId = parent?.id ?? null;
  const list = parent ? parent.list : active.list;

  // 在同级、同完成状态的兄弟里排第几：数空隙前面有几个
  let index = 0;
  if (parent?.collapsed && rest[g - 1]?.id === parent.id) index = Number.MAX_SAFE_INTEGER;
  else for (let k = 0; k < g; k++) if (rest[k].parentId === parentId && rest[k].depth === depth && rest[k].done === active.done) index++;

  const origin = rows.filter((r) => r.parentId === active.parentId && r.depth === active.depth && r.done === active.done);
  const unchanged = parentId === active.parentId && list === active.list && index === origin.findIndex((r) => r.id === activeId);
  return { list, parentId, index, depth, afterId: rest[g - 1]?.id ?? null, unchanged };
}

/** 横向位移换算成想要的深度：每 indent 像素一级 */
export const depthFromOffset = (startDepth: number, dx: number, indent: number) => startDepth + dx / indent;
