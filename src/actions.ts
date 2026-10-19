// 带动效的高层操作（桌面），供各组件调用。时序见 design_handoff_focus/tokens.json → motion
import { VIEW_COPY } from './components/copy';
import { chime } from './effects';
import { blink, bump, centerOf, flyClone, flySpark, prepareHandoff, preparePop, reduceMotion, ringBurst, setExitMode, sparks } from './fx';
import { inZone, nowOf, zoneOf } from './model';
import { flashRow, showToast, useData, useUi } from './store';
import type { ListId, Todo, ViewId } from './types';

const listLabel = (list: ListId) => VIEW_COPY[list].en;

// ---------- 找界面上的元素 ----------

const esc = (id: string) => CSS.escape(id);

/** 界面上代表这一条的那一行：列表行、GOAL 卡、聚焦项、聚焦项下的子任务 */
export const rowOf = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-node-id="${esc(id)}"] > .row, [data-goal-id="${esc(id)}"], [data-zone-item="${esc(id)}"], li.zsub[data-node-id="${esc(id)}"]`,
  );
export const zoneItemOf = (id: string) => document.querySelector<HTMLElement>(`[data-zone-item="${esc(id)}"]`);
const checkOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-cb-id="${esc(id)}"], [data-node-id="${esc(id)}"] > .row .cb, [data-goal-id="${esc(id)}"] .cb`);

/** 页签胶囊或侧栏上那个分区的图标（compact / regular 只会有一个看得见） */
export function tabTarget(view: ViewId): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-view-tab="${view}"] .fly-target`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const soundOn = () => useData.getState().settings.sound;

function setCompleting(id: string, on: boolean) {
  const cur = { ...useUi.getState().completing };
  if (on) cur[id] = true;
  else delete cur[id];
  useUi.getState().set({ completing: cur });
}

/** 星芒飞向 HISTORY，落地时图标放大 1.18 并冒 +1 */
function flyToHistory(from: { x: number; y: number } | null, delay = 0) {
  const target = tabTarget('history');
  const to = centerOf(target);
  if (!from || !to) return;
  flySpark(from, to, { duration: 300, delay, onLand: () => bump(target, true) });
}

/** 克隆飞向某个分区的页签，落地时弹一下 */
function flyToTab(el: HTMLElement | null, view: ViewId) {
  const target = tabTarget(view);
  const to = centerOf(target);
  if (el && to) flyClone(el, to, { scale: 0.3, duration: 320, onLand: () => bump(target) });
  else bump(target);
}

// ---------- 完成 ----------

/**
 * 完成普通行和子任务（760ms）：圈缩 .85 → 填色画勾 → 6 颗星芒 → 划线 → 一颗星芒飞向 HISTORY。
 * 聚焦项下的子任务也走这里（勾选圈带 data-cb-id，星芒从它那里迸出）。
 */
export function toggleTodo(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  if (todo.done) {
    useData.getState().uncomplete(todo.id);
    return;
  }
  if (inZone(todo)) {
    completeZoneItem(todo);
    return;
  }
  const quick = reduceMotion();
  setCompleting(todo.id, true);
  const at = centerOf(checkOf(todo.id));
  if (at) sparks(at, { delay: 120 });
  if (soundOn()) chime();
  setTimeout(
    () => {
      const from = centerOf(checkOf(todo.id)) ?? at;
      useData.getState().complete(todo.id);
      setCompleting(todo.id, false);
      flyToHistory(from);
    },
    quick ? 150 : 460,
  );
}

/**
 * 完成聚焦项（820ms）：按下圈缩到 .82 → 填黑画荧光绿勾、外圈爆开 + 6 颗星芒、标题划线 →
 * 这一件在聚焦区里淡出收起，下面的补位 → 一颗星芒飞向 HISTORY。聚焦区空了也不自动补下一件。
 */
export function completeZoneItem(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  const item = zoneItemOf(todo.id);
  const quick = reduceMotion() || !item;
  setCompleting(todo.id, true);
  if (soundOn()) chime();
  const btn = item?.querySelector<HTMLElement>('.zring');
  const at = centerOf(btn);
  if (at && !quick) {
    btn!.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' });
    ringBurst(at, 40, 80);
    sparks(at, { size: [9, 12], dist: [30, 50], rotate: 90, life: 380, delay: 80 });
  }
  setTimeout(
    () => {
      const from = centerOf(zoneItemOf(todo.id)?.querySelector('.zring')) ?? at;
      useData.getState().complete(todo.id);
      flyToHistory(from);
      // 离场动画播完再清：收起的那一下还保持打勾、划线的样子
      setTimeout(() => setCompleting(todo.id, false), quick ? 0 : 400);
    },
    quick ? 150 : 440,
  );
}

// ---------- 送去验证 / 送进 FOCUS / 移动 ----------

/**
 * 送去验证（520ms）：眼睛眨一下 → 染成 VERIFY 色 → 缩到 .3 沿弧线飞向 VERIFY 页签。
 * 子项不飞，原地挂「待验证」；已经待验证的子项再点一次取消。
 */
export function sendToVerify(todo: Todo, btn?: Element | null) {
  const store = useData.getState();
  if (todo.parentId === null && todo.list === 'verify' && !todo.done) return;
  if (todo.testing && !todo.done) {
    store.unmarkTest(todo.id);
    return;
  }
  blink(btn);
  if (soundOn()) chime(0.5, 0.6);
  const quick = reduceMotion();
  if (todo.parentId !== null) {
    const row = rowOf(todo.id);
    if (row && !quick) setTimeout(() => row.classList.add('tint-verify'), 120);
    setTimeout(
      () => {
        row?.classList.remove('tint-verify');
        useData.getState().markForTest(todo.id);
      },
      quick ? 0 : 280,
    );
    return;
  }
  const el = rowOf(todo.id);
  if (el && !quick) setTimeout(() => el.classList.add('tint-verify'), 120);
  setTimeout(
    () => {
      el?.classList.remove('tint-verify');
      if (!quick) flyToTab(el, 'verify');
      setExitMode(todo.id, 'collapse');
      useData.getState().markForTest(todo.id);
    },
    quick ? 0 : 200,
  );
}

/** 送进 FOCUS（INBOX 的星芒钮、VERIFY 的退回）：排在聚焦区后面（「接下来」第一位） */
export function sendToFocus(todo: Todo, btn?: Element | null) {
  const at = centerOf(btn);
  if (at) sparks(at, { count: 6, size: [6, 9], dist: [16, 26], life: 340 });
  const row = rowOf(todo.id);
  setExitMode(todo.id, 'collapse');
  flyToTab(row, 'focus');
  useData.getState().sendToFocus(todo.id);
  const s = useData.getState();
  const t = s.todos.find((x) => x.id === todo.id);
  if (t && inZone(t) && zoneOf(s.todos).length === 1) showToast('FOCUS 空着，它直接进了聚焦区');
}

/** 右键菜单「移到 …」：子项选自己的列表 = 提升为顶层项 */
export function moveTodoTo(todo: Todo, list: ListId) {
  if (list === 'focus' && !(todo.list === 'focus' && todo.parentId !== null)) {
    sendToFocus(todo);
    return;
  }
  if (list === 'verify') {
    sendToVerify(todo);
    return;
  }
  if (list === todo.list) {
    useData.getState().move(todo.id, list);
    return;
  }
  const el = rowOf(todo.id);
  setExitMode(todo.id, 'collapse');
  flyToTab(el, list);
  useData.getState().move(todo.id, list);
}

/**
 * 拖到页签 / 侧栏的列表上：整棵移过去成顶层。
 * FOCUS 排在聚焦区后面（送进 FOCUS），VERIFY 和其它列表排在最前（放进 VERIFY 等于送去验证：回到未完成）。
 */
export function moveToListByDrag(todo: Todo, list: ListId) {
  if (list === 'focus') {
    sendToFocus(todo);
    return;
  }
  const el = rowOf(todo.id);
  setExitMode(todo.id, 'collapse');
  if (list === 'verify' && soundOn()) chime(0.5, 0.6);
  flyToTab(el, list);
  useData.getState().place(todo.id, { list, parentId: null, index: 0 });
}

// ---------- 设为现在 / 移出聚焦区 ----------

/**
 * 设为现在（450ms）：放进聚焦区最前。
 * - 「接下来」里的行（或聚焦项的子任务）：行浮起 → 移上去成为聚焦区第一件，荧光绿闪一下；
 * - 聚焦区里的：直接排到最前，其余的让位；
 * - 别的列表来的：克隆飞向 FOCUS 页签，提示一下。
 */
export function setNow(todo: Todo) {
  const s = useData.getState();
  if (nowOf(s.todos)?.id === todo.id) return;
  const inFocus = s.prefs.activeView === 'focus' && !useUi.getState().trashOpen && todo.list === 'focus';
  const row = rowOf(todo.id);
  const quick = reduceMotion();

  if (!inFocus) {
    setExitMode(todo.id, 'collapse');
    if (!quick) flyToTab(row, 'focus');
    s.setNow(todo.id);
    showToast(`已放进聚焦区 · ${listLabel('focus')}`);
    return;
  }
  if (inZone(todo)) {
    s.setNow(todo.id);
    flashRow(todo.id);
    return;
  }

  const go = () => {
    row?.classList.remove('lift');
    prepareHandoff(todo.id, row, 0);
    setExitMode(todo.id, 'instant');
    useData.getState().setNow(todo.id);
    flashRow(todo.id);
  };
  if (quick || !row) go();
  else {
    row.classList.add('lift');
    setTimeout(go, 120);
  }
}

/** 移出聚焦区：回到「接下来」第一位，那一行荧光绿闪一下 */
export function unfocusTodo(todo: Todo) {
  if (!inZone(todo)) return;
  useData.getState().unfocus(todo.id);
  flashRow(todo.id);
}

// ---------- 删除 / 回收站 ----------

/** 删除进回收站；提示条上 5 秒内可撤销 */
export function deleteWithUndo(todo: Todo) {
  const entryId = useData.getState().remove(todo.id);
  if (!entryId) return;
  const count = useData.getState().trash.find((e) => e.id === entryId)?.items.length ?? 1;
  const extra = count > 1 ? `（含 ${count - 1} 个子项）` : '';
  showToast(`已删除「${truncate(todo.title, 14)}」${extra}`, entryId);
}

/** 提示条上的「撤销」（⌘Z 也走这里）：删除的从回收站放回，拖动的放回原位 */
export function undoDelete() {
  const { toast } = useUi.getState();
  if (!toast) return;
  if (toast.undoEntry) useData.getState().restoreTrash(toast.undoEntry);
  else if (toast.undo) toast.undo();
  else return;
  useUi.getState().set({ toast: null });
}

/** 从回收站恢复，并提示回到了哪个列表 */
export function restoreFromTrash(entryId: string) {
  const list = useData.getState().restoreTrash(entryId);
  if (!list) return;
  bump(tabTarget(list));
  showToast(`已恢复到 ${listLabel(list)}`);
}

// ---------- 新建 / 子任务 ----------

/**
 * 新建：FOCUS 顶层默认排在聚焦区后面（「接下来」第一位）；top = 新建并放进聚焦区最前（⌘/Ctrl + 回车）。
 * 新行撑开并荧光绿闪一下；进了聚焦区的（含 FOCUS 原本是空的）从上面弹出来。
 */
export function addTodo(title: string, list: ListId, top = false): string | null {
  const id = useData.getState().add(title, list, null, top ? 'top' : undefined);
  if (!id) return null;
  const t = useData.getState().todos.find((x) => x.id === id);
  if (t && inZone(t)) preparePop(id);
  flashRow(id);
  return id;
}

/** 打开某个分区（页签、侧栏、快捷键） */
export function goView(view: ViewId) {
  useUi.getState().set({ trashOpen: false, menu: null, composeFocus: false });
  useData.getState().setPrefs({ activeView: view });
}

export function openTrash() {
  useUi.getState().set({ trashOpen: true, menu: null, mainMenuOpen: false, profileMenuOpen: false, editingId: null, draft: null });
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
