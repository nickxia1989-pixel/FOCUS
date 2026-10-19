// 带动画 / 触感反馈的高层操作，供各组件调用（动效时序见 design_handoff_focus/screens/Motion.jpg）
import { flushSync } from 'react-dom';
import { chime } from '../effects';
import { LISTS, type ListId, type Todo } from '../types';
import type { Section } from './data';
import { useChrome } from './chrome';
import { flyGhost, flyStar, reduceMotion, ringBurst, sparkBurst } from './fx';
import { haptic } from './native';
import { useData } from './store';
import { markAdded, pulse, showToast, useUi } from './ui';

/** 普通行：勾选后先播动画（填色、画勾、星芒、划线），稍后再真正写入（期间保持原位置） */
const CELEBRATE_MS = 460;
/** 完成 NOW：卡片 380–560ms 抽走，560ms 写入，下一件接替成为 NOW */
const HANDOFF_MS = 560;

export const accentOf = (s: Section) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--c-${s}`).trim() || '#0b0b0c';

export const listLabel = (list: ListId) => LISTS.find((l) => l.id === list)!.label;

function centerOf(el: Element | null | undefined) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 「飞向某个分区」的终点：网页里看得见的目标（网页自己画的页签 / 侧栏），其次是原生页签栏上那个分区的图标
 */
function sectionTarget(s: Section) {
  for (const el of document.querySelectorAll(`[data-target="${s}"]`)) {
    if (el.closest('[inert]')) continue; // 收起的侧栏 / 页签
    const c = centerOf(el);
    if (c && c.y > 0 && c.y < window.innerHeight) return c;
  }
  return useChrome.getState().geo.targets[s] ?? null;
}

function rowAnchor(id: string) {
  const node = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  return centerOf(node?.querySelector('.check, .sc, .q-no') ?? node);
}

export function goSection(section: Section) {
  const ui = useUi.getState();
  if (ui.editingId || ui.menu || ui.swipedId) ui.set({ editingId: null, menu: null, swipedId: null });
  if (useData.getState().prefs.section === section) return;
  haptic.selection();
  useData.getState().setSection(section);
}

/** 完成普通行（列表行、接下来的行、NOW 卡上的子任务）：填色画勾 → 6 颗星芒 → 划线 → 一颗星芒飞向 HISTORY */
export function toggleTodo(todo: Todo) {
  const ui = useUi.getState();
  if (ui.completing[todo.id]) return;
  if (todo.done) {
    haptic.light();
    useData.getState().uncomplete(todo.id);
    return;
  }

  ui.set({ completing: { ...ui.completing, [todo.id]: true }, swipedId: null });
  haptic.light();
  const at = rowAnchor(todo.id);
  if (at) setTimeout(() => sparkBurst(at.x, at.y), 120);
  if (useData.getState().prefs.sound) chime();

  setTimeout(() => {
    const from = rowAnchor(todo.id) ?? at;
    useData.getState().complete(todo.id);
    haptic.success();
    const rest = { ...useUi.getState().completing };
    delete rest[todo.id];
    useUi.getState().set({ completing: rest });
    // 一颗星芒飞向 HISTORY，告诉用户它被记下了
    const to = sectionTarget('history');
    if (from && to) flyStar(from, to, () => pulse('history'));
    else pulse('history');
  }, reduceMotion() ? 120 : CELEBRATE_MS);
}

/** 完成 NOW · 换场：按下 → 圆钮外圈爆开 + 星芒 → 标题划线 → 卡片抽走 → 下一件升上来变成 NOW */
export function completeNow(todo: Todo, button?: Element | null) {
  const ui = useUi.getState();
  if (ui.handoff || ui.completing[todo.id]) return;
  haptic.medium();
  ui.set({ handoff: todo.id, swipedId: null, editingId: null });
  const at = centerOf(button) ?? rowAnchor(todo.id);
  if (at)
    setTimeout(() => {
      ringBurst(at.x, at.y, 60);
      sparkBurst(at.x, at.y, 6, [40, 60]);
    }, 80);
  if (useData.getState().prefs.sound) chime();
  setTimeout(() => haptic.success(), reduceMotion() ? 0 : 380);
  setTimeout(() => {
    useData.getState().complete(todo.id);
    useUi.getState().set({ handoff: null });
    const to = sectionTarget('history');
    if (at && to) flyStar(at, to, () => pulse('history'));
    else pulse('history');
  }, reduceMotion() ? 150 : HANDOFF_MS);
}

/** 设为现在：放进聚焦区最前，成为 NOW 卡（行和 NOW 卡交换位置由 motion 的 layoutId 动画接上） */
export function setNow(todo: Todo) {
  haptic.light();
  useUi.getState().set({ swipedId: null, menu: null });
  const wasElsewhere = todo.list !== 'focus';
  useData.getState().setNow(todo.id);
  if (wasElsewhere) {
    pulse('focus');
    showToast(`「${truncate(todo.title, 12)}」已设为现在`);
  }
}

/** 移出聚焦区：回到「接下来」第一位 */
export function unfocusTodo(todo: Todo) {
  haptic.light();
  useUi.getState().set({ swipedId: null, menu: null });
  useData.getState().unfocus(todo.id);
}

/** 送进 FOCUS（INBOX、VERIFY 上的星芒钮）：排在聚焦区后面，星芒飞向 FOCUS 页签 */
export function sendToFocus(todo: Todo, fromEl?: Element | null) {
  const from = centerOf(fromEl) ?? rowAnchor(todo.id);
  haptic.light();
  if (from) sparkBurst(from.x, from.y, 6, [24, 36]);
  useData.getState().sendToFocus(todo.id);
  useUi.getState().set({ swipedId: null, menu: null });
  const to = sectionTarget('focus');
  if (from && to) flyStar(from, to, () => pulse('focus'), '');
  else showToast('已送进 FOCUS');
}

export function moveTodoTo(todo: Todo, list: ListId, fromEl?: Element | null) {
  const from = centerOf(fromEl) ?? rowAnchor(todo.id);
  if (list === 'focus' && todo.list !== 'focus') return sendToFocus(todo, fromEl);
  useData.getState().move(todo.id, list);
  useUi.getState().set({ swipedId: null, menu: null });
  haptic.light();
  if (list === todo.list) {
    showToast('已移出父项，成为顶层项');
    return;
  }
  const to = sectionTarget(list);
  if (from && to) flyStar(from, to, () => pulse(list), '');
  else showToast(`已移到 ${listLabel(list)}`);
}

/**
 * 送去验证：眼睛眨一下 → 行染成 VERIFY 色、缩小沿弧线飞向 VERIFY 页签 → 角标数字变化。
 * 顶层项整棵进 VERIFY；子项原地挂「待验证」。
 */
export function sendToVerify(todo: Todo, fromEl?: Element | null) {
  haptic.light();
  useUi.getState().set({ swipedId: null, menu: null });
  fromEl?.classList.add('blink');
  setTimeout(() => fromEl?.classList.remove('blink'), 200);
  if (todo.parentId !== null) {
    useData.getState().markForTest(todo.id);
    return;
  }
  const node = document.querySelector(`[data-node-id="${CSS.escape(todo.id)}"]`);
  const to = sectionTarget('verify');
  const go = () => {
    useData.getState().markForTest(todo.id);
    pulse('verify');
  };
  if (node && to && !reduceMotion()) {
    setTimeout(() => {
      flyGhost(node.querySelector('.q-row, .row, .now-title') ?? node, to, accentOf('verify'));
      go();
    }, 160);
  } else go();
}

/** 升一级（长按菜单）：排在原父项后面；顶层项不动 */
export function outdent(todo: Todo) {
  if (todo.parentId === null) return;
  haptic.light();
  useUi.getState().set({ swipedId: null, menu: null });
  useData.getState().outdent(todo.id);
  markAdded(todo.id);
}

/** 待验证的子项再点一次：取消待验证 */
export function toggleTest(todo: Todo, fromEl?: Element | null) {
  if (todo.testing) {
    haptic.light();
    useData.getState().unmarkTest(todo.id);
  } else sendToVerify(todo, fromEl);
}

/** 删除进回收站；提示条上可直接撤销 */
export function deleteWithUndo(todo: Todo) {
  const entryId = useData.getState().remove(todo.id);
  useUi.getState().set({ swipedId: null, menu: null });
  if (!entryId) return;
  haptic.warning();
  const entry = useData
    .getState()
    .profiles.flatMap((p) => p.trash)
    .find((e) => e.id === entryId);
  const count = entry?.items.length ?? 1;
  const extra = count > 1 ? `（含 ${count - 1} 个子项）` : '';
  showToast(`已删除「${truncate(todo.title, 10)}」${extra}`, entryId);
}

export function undoDelete() {
  const { toast } = useUi.getState();
  if (!toast?.undoEntry) return;
  useData.getState().restoreTrash(toast.undoEntry);
  haptic.light();
  useUi.getState().set({ toast: null });
}

export function restoreFromTrash(entryId: string) {
  const list = useData.getState().restoreTrash(entryId);
  if (!list) return;
  haptic.light();
  pulse(list);
  showToast(`已恢复到 ${listLabel(list)}`);
}

/** 切换空间（头像菜单） */
export function switchSpace(id: string) {
  const d = useData.getState();
  useUi.getState().set({ menu: null, more: null, swipedId: null, editingId: null });
  if (id === d.activeId) return;
  const p = d.profiles.find((x) => x.id === id);
  if (!p) return;
  haptic.light();
  d.switchProfile(id);
  showToast(`已切换到「${p.name}」`);
}

// ---------- 新建输入卡片 ----------

/**
 * 新建：FOCUS 顶层项默认排在 NOW 之后（「排在现在之后」关掉时新建并设为现在），其它列表排在最前。
 * 新的那一行撑开并闪一下荧光绿
 */
export function addTodo(title: string, list: ListId, parentId: string | null, afterNow: boolean) {
  const placement = list === 'focus' && !parentId ? (afterNow ? 'afterNow' : 'top') : undefined;
  const id = useData.getState().add(title, list, parentId, placement);
  if (id) {
    haptic.light();
    markAdded(id);
  }
  return id;
}

let composerInput: HTMLTextAreaElement | null = null;
export function registerComposerInput(el: HTMLTextAreaElement | null) {
  composerInput = el;
}

/**
 * 打开底部的新建卡片。输入框常驻在 DOM 里，必须在点击事件里同步 focus，
 * iOS 才会弹出键盘（异步 focus 会被 WebKit 忽略）。
 */
export function openComposer(list: ListId, parentId: string | null = null) {
  useUi.getState().set({ composer: { open: true, list, parentId }, menu: null, swipedId: null, editingId: null });
  composerInput?.focus({ preventScroll: true });
}

export function closeComposer() {
  const ui = useUi.getState();
  if (!ui.composer.open) return;
  ui.set({ composer: { ...ui.composer, open: false, parentId: null } });
  composerInput?.blur();
}

/** 原地编辑标题：同样需要在点击里同步渲染出输入框再 focus */
export function startEdit(id: string) {
  flushSync(() => useUi.getState().set({ editingId: id, menu: null, swipedId: null }));
  const input = document.querySelector<HTMLTextAreaElement>(`[data-edit-input="${CSS.escape(id)}"]`);
  if (input) {
    input.focus({ preventScroll: true });
    const n = input.value.length;
    input.setSelectionRange(n, n);
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
