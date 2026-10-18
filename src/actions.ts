// 带动效的高层操作（桌面），供各组件调用。时序见 design_handoff_focus/tokens.json → motion
import { VIEW_COPY } from './components/copy';
import { chime } from './effects';
import {
  blink,
  bump,
  cardOut,
  centerOf,
  flyClone,
  flySpark,
  prepareHandoff,
  preparePop,
  reduceMotion,
  ringBurst,
  setExitMode,
  sparks,
} from './fx';
import { nowOf } from './model';
import { flashRow, showToast, useData, useUi } from './store';
import type { ListId, Todo, ViewId } from './types';

const listLabel = (list: ListId) => VIEW_COPY[list].en;

// ---------- 找界面上的元素 ----------

const esc = (id: string) => CSS.escape(id);

export const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-node-id="${esc(id)}"] > .row, [data-goal-id="${esc(id)}"]`);
export const nowCardOf = (id: string) => document.querySelector<HTMLElement>(`[data-now-id="${esc(id)}"]`);
const checkOf = (id: string) => document.querySelector<HTMLElement>(`[data-node-id="${esc(id)}"] > .row .cb, [data-goal-id="${esc(id)}"] .cb`);

/** 页签胶囊或侧栏上那个分区的图标（compact / regular 只会有一个看得见） */
export function tabTarget(view: ViewId): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-view-tab="${view}"] .fly-target`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** FOCUS 里排在 id 后面的那件未完成顶层项（NOW 被拿走后接替的那件） */
function nextAfter(id: string): Todo | null {
  const todos = useData.getState().todos;
  const open = todos.filter((t) => t.list === 'focus' && t.parentId === null && !t.done && t.id !== id);
  const rest = todos.filter((t) => t.id !== id);
  return open.length ? nowOf(rest) : null;
}

const isNow = (todo: Todo) => nowOf(useData.getState().todos)?.id === todo.id;
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

/** 完成普通行（760ms）：圈缩 .85 → 填色画勾 → 6 颗星芒 → 划线 → 一颗星芒飞向 HISTORY */
export function toggleTodo(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  if (todo.done) {
    useData.getState().uncomplete(todo.id);
    return;
  }
  if (isNow(todo)) {
    completeNow(todo);
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
 * 完成 NOW · 换场（1000ms）：按下 → 外圈爆开 + 星芒 → 标题划线 → 卡片向上抽走 →
 * 队列第 02 行变形成新的 NOW 卡 → 其余行上移
 */
export function completeNow(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  const card = nowCardOf(todo.id);
  const quick = reduceMotion() || !card;
  setCompleting(todo.id, true);
  if (soundOn()) chime();
  const btn = card?.querySelector<HTMLElement>('.now-done');
  const at = centerOf(btn);
  if (at && !quick) {
    btn!.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' });
    ringBurst(at, 42, 80);
    sparks(at, { color: '#0B0B0C', size: [11, 12], dist: [40, 60], rotate: 90, life: 360, delay: 80 });
  }
  setTimeout(
    () => {
      const cur = nowCardOf(todo.id);
      const next = nextAfter(todo.id);
      if (cur && !quick) cardOut(cur);
      if (next) {
        prepareHandoff(next.id, rowOf(next.id), 80);
        setExitMode(next.id, 'instant');
      }
      useData.getState().complete(todo.id);
      setCompleting(todo.id, false);
      flyToHistory(at);
    },
    quick ? 150 : 380,
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
  const nowCard = isNow(todo) ? nowCardOf(todo.id) : null;
  const el = nowCard ?? rowOf(todo.id);
  if (el && !quick) setTimeout(() => el.classList.add('tint-verify'), 120);
  setTimeout(
    () => {
      el?.classList.remove('tint-verify');
      if (!quick) flyToTab(el, 'verify');
      if (nowCard) {
        const next = nextAfter(todo.id);
        if (next) {
          prepareHandoff(next.id, rowOf(next.id), 60);
          setExitMode(next.id, 'instant');
        }
      } else setExitMode(todo.id, 'collapse');
      useData.getState().markForTest(todo.id);
    },
    quick ? 0 : 200,
  );
}

/** 送进 FOCUS（INBOX 的星芒钮、VERIFY 的退回）：排在 NOW 之后 */
export function sendToFocus(todo: Todo, btn?: Element | null) {
  const at = centerOf(btn);
  if (at) sparks(at, { count: 6, size: [6, 9], dist: [16, 26], life: 340 });
  const row = rowOf(todo.id);
  const wasEmpty = !nowOf(useData.getState().todos);
  setExitMode(todo.id, 'collapse');
  flyToTab(row, 'focus');
  useData.getState().sendToFocus(todo.id);
  if (wasEmpty) showToast('FOCUS 空着，它直接成了「现在」');
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
  const el = isNow(todo) ? nowCardOf(todo.id) : rowOf(todo.id);
  if (isNow(todo)) {
    const next = nextAfter(todo.id);
    if (next) {
      prepareHandoff(next.id, rowOf(next.id), 60);
      setExitMode(next.id, 'instant');
    }
  } else setExitMode(todo.id, 'collapse');
  flyToTab(el, list);
  useData.getState().move(todo.id, list);
}

// ---------- 设为现在 ----------

/**
 * 设为现在（450ms）：行浮起 → 与 NOW 卡交换位置 → 荧光绿交接。
 * fromRect：拖到 NOW 卡上松手时拖拽预览的位置，此时不再浮起。
 * 从别的列表来的直接移进 FOCUS 第 1 位，克隆飞向 FOCUS 页签。
 */
export function setNow(todo: Todo, fromRect?: DOMRect) {
  const s = useData.getState();
  const cur = nowOf(s.todos);
  if (cur?.id === todo.id) return;
  const inFocus = s.prefs.activeView === 'focus' && !useUi.getState().trashOpen && todo.list === 'focus';
  const row = rowOf(todo.id);
  const quick = reduceMotion();

  if (!inFocus) {
    setExitMode(todo.id, 'collapse');
    if (!quick) flyToTab(row, 'focus');
    s.setNow(todo.id);
    showToast(`已设为现在 · ${listLabel('focus')}`);
    return;
  }

  const go = () => {
    row?.classList.remove('lift');
    const card = cur ? nowCardOf(cur.id) : null;
    // 原来的 NOW 往下沉到队列里，换下来的那行荧光绿闪一下
    if (card && !quick) cardOut(card, 'down');
    prepareHandoff(todo.id, fromRect ?? row, 0);
    setExitMode(todo.id, 'instant');
    useData.getState().setNow(todo.id);
    if (cur) flashRow(cur.id);
  };
  if (fromRect || quick || !row) go();
  else {
    row.classList.add('lift');
    setTimeout(go, 120);
  }
}

// ---------- 删除 / 回收站 ----------

/** 删除进回收站；提示条上 5 秒内可撤销 */
export function deleteWithUndo(todo: Todo) {
  if (isNow(todo)) {
    const card = nowCardOf(todo.id);
    if (card) cardOut(card);
    const next = nextAfter(todo.id);
    if (next) {
      prepareHandoff(next.id, rowOf(next.id), 60);
      setExitMode(next.id, 'instant');
    }
  }
  const entryId = useData.getState().remove(todo.id);
  if (!entryId) return;
  const count = useData.getState().trash.find((e) => e.id === entryId)?.items.length ?? 1;
  const extra = count > 1 ? `（含 ${count - 1} 个子项）` : '';
  showToast(`已删除「${truncate(todo.title, 14)}」${extra}`, entryId);
}

export function undoDelete() {
  const { toast } = useUi.getState();
  if (!toast?.undoEntry) return;
  useData.getState().restoreTrash(toast.undoEntry);
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
 * 新建：FOCUS 顶层默认排在 NOW 之后；top = 新建并设为现在（⌘/Ctrl + 回车）。
 * 新行撑开并荧光绿闪一下。
 */
export function addTodo(title: string, list: ListId, top = false): string | null {
  const prevNow = list === 'focus' ? nowOf(useData.getState().todos) : null;
  const id = useData.getState().add(title, list, null, top ? 'top' : undefined);
  if (!id) return null;
  const isNowNow = list === 'focus' && nowOf(useData.getState().todos)?.id === id;
  if (isNowNow) {
    // 新建并设为现在（或 FOCUS 原本是空的）：新卡弹出来，换下来的那件闪一下
    preparePop(id);
    if (prevNow) flashRow(prevNow.id);
  } else flashRow(id);
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
