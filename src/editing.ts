// 大纲式编辑的界面接线（桌面）。规则（桌面和 iOS 同一套）：
// - Enter：保存，并在后面开一个同层级的空行；空行有内容再回车才新建，接着再开下一行；空行上直接回车就结束
// - Tab / Shift+Tab：缩进 / 反缩进（正在编辑的条目和空行都可以），编辑框不关、没保存的字不丢；
//   同级第一个按 Tab、顶层按 Shift+Tab 不动，编辑框抖一下
// - Backspace：空行上关掉空行，回到上一条继续编辑
// - Esc：放弃这次修改 / 关掉空行
// - ⌥⇧↑ / ⌥⇧↓（Windows：Alt+Shift+↑/↓）：同级里上移 / 下移
// - ↑ / ↓：光标在开头 / 结尾时跳到上一条 / 下一条继续编辑
// - 拼音组字时以上按键一律不处理
// 算位置的纯函数在 src/outline.ts（有单元测试）。
import type { KeyboardEvent } from 'react';
import { flashRow, useData, useUi } from './store';
import { setExitMode } from './fx';
import { inZone } from './model';
import {
  canIndent,
  canOutdent,
  draftAfter,
  draftBackTarget,
  draftChildOf,
  draftIndent,
  draftInsert,
  draftOutdent,
  draftShift,
  moveStep,
  type Draft,
} from './outline';
import type { VV } from './sync/clock';

export const DRAFT_ID = '__draft';

// ---------- 会话：编辑框换位置（缩进、移动）时会重新挂载，靠它保住没保存的文字和光标 ----------

export interface EditSession {
  id: string;
  text: string;
  /** 开始编辑时的标题，Esc 放弃时用；保存时比较有没有改 */
  original: string;
  /** 开始编辑时的知识：编辑期间远端也改了标题，提交时会变成冲突而不是盖掉远端 */
  base: VV;
  start: number;
  end: number;
  /** 正在换位置：旧编辑框卸载时的失焦不算「点到别处」 */
  relocating: boolean;
}

let session: EditSession | null = null;
/** 下一次打开编辑框时光标放哪 */
let caretWanted: 'start' | 'end' = 'end';

/** 空行里打的字（空行换位置时保留） */
let draftText = '';
let draftRelocating = false;

/** 编辑框挂载时取会话：同一条继续用（换位置后），否则新开 */
export function attachSession(id: string, title: string): EditSession {
  if (session?.id === id) return session;
  const len = title.length;
  const at = caretWanted === 'start' ? 0 : len;
  session = { id, text: title, original: title, base: useData.getState().clock.knowledge, start: at, end: at, relocating: false };
  caretWanted = 'end';
  return session;
}

export const getDraftText = () => draftText;
export const setDraftText = (t: string) => {
  draftText = t;
};
export const isDraftRelocating = () => draftRelocating;

/** 打开某一条的编辑框（双击、右键「编辑」、键盘跳转） */
export function beginEdit(id: string, caret: 'start' | 'end' = 'end') {
  if (session && session.id !== id) session = null;
  caretWanted = caret;
  useUi.getState().set({ editingId: id, draft: null, menu: null });
}

/** 结束编辑：save 时有改动才写入 */
export function finishEdit(save: boolean) {
  const s = session;
  session = null;
  if (s && save && s.text.trim() && s.text.trim() !== s.original) useData.getState().rename(s.id, s.text, s.base);
  if (s && useUi.getState().editingId === s.id) useUi.getState().set({ editingId: null });
}

// ---------- 空行 ----------

/** 打开空行（会关掉正在编辑的那条之外的空行） */
export function openDraft(d: Draft | null, keepText = false) {
  if (!d) return;
  if (!keepText) draftText = '';
  ensureVisible(d.parentId);
  useUi.getState().set({ draft: d, editingId: null, menu: null });
}

export function closeDraft() {
  draftText = '';
  draftRelocating = false;
  if (useUi.getState().draft) useUi.getState().set({ draft: null });
}

/** 「添加子任务」：在子项最后开一个空行 */
export function startAddChild(parentId: string) {
  openDraft(draftChildOf(useData.getState().todos, parentId));
}

/** 空行里的字真正新建成一条，返回新的 id */
function commitDraft(d: Draft, text: string): string | null {
  if (!text.trim()) return null;
  const { list, parentId, placement } = draftInsert(d);
  const id = useData.getState().add(text, list, parentId, placement);
  if (id) flashRow(id);
  return id;
}

/** 空行失焦：有字就留下（新建），然后关掉 */
export function blurDraft() {
  if (draftRelocating) return;
  const d = useUi.getState().draft;
  if (d) commitDraft(d, draftText);
  closeDraft();
}

// ---------- 让新位置看得见 ----------

/** 挂到某个父项下以后，父项要是收着就展开（「接下来」里的行用本次运行的展开状态，聚焦项总是展开） */
export function ensureVisible(parentId: string | null) {
  if (!parentId) return;
  const s = useData.getState();
  const p = s.todos.find((t) => t.id === parentId);
  if (!p) return;
  const ui = useUi.getState();
  if (p.list === 'focus' && p.parentId === null && !inZone(p) && !ui.queueOpen[p.id])
    ui.set({ queueOpen: { ...ui.queueOpen, [p.id]: true } });
  if (p.collapsed) s.setCollapsed(p.id, false);
}

// ---------- 抖一下 ----------

export function shake(el: Element | null | undefined) {
  el?.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
    { duration: 260, easing: 'ease-out' },
  );
}

// ---------- 上一条 / 下一条 ----------

/** 当前视图里能编辑的条目，按界面上从上到下的顺序（含空行） */
function editableIds(from: Element): string[] {
  const root = from.closest('.view') ?? document;
  return [...root.querySelectorAll<HTMLElement>('[data-edit-id]')].map((e) => e.dataset.editId!);
}

function neighbor(from: Element, id: string, dir: -1 | 1): string | null {
  const ids = editableIds(from);
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

/** 换了位置后，把焦点和光标放回新的编辑框 */
function refocus(selector: string, start: number, end: number) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      // 旧位置上的那份可能还在离场动画里：新挂载的编辑框会自己拿焦点，优先用它
      const all = [...document.querySelectorAll<HTMLTextAreaElement>(selector)];
      const el = all.find((e) => e === document.activeElement) ?? all[all.length - 1];
      if (session) session.relocating = false;
      draftRelocating = false;
      if (!el) return;
      if (document.activeElement !== el) el.focus();
      el.setSelectionRange(start, end);
      el.closest('[data-edit-id]')?.scrollIntoView({ block: 'nearest' });
    }),
  );
}

const isMove = (e: KeyboardEvent) => e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey;
export const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

// ---------- 正在编辑的条目 ----------

/** 编辑框的按键；返回 true 表示已处理 */
export function onEditKey(e: KeyboardEvent<HTMLTextAreaElement>, id: string, el: HTMLTextAreaElement): boolean {
  if (composing(e) || !session || session.id !== id) return false;
  const store = useData.getState();
  const todos = store.todos;
  const s = session;

  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const d = draftAfter(todos, id);
    finishEdit(true);
    openDraft(d);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    finishEdit(false);
    return true;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const out = e.shiftKey;
    if (out ? !canOutdent(todos, id) : !canIndent(todos, id)) {
      shake(el.closest('[data-edit-id]'));
      return true;
    }
    s.relocating = true;
    s.start = el.selectionStart;
    s.end = el.selectionEnd;
    // 换到新位置：旧位置上那一行直接消失，不播收起动画
    setExitMode(id, 'instant');
    if (out) store.outdent(id);
    else store.indent(id);
    ensureVisible(useData.getState().todos.find((t) => t.id === id)?.parentId ?? null);
    refocus(`[data-editor="${CSS.escape(id)}"]`, s.start, s.end);
    return true;
  }
  if (isMove(e) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    // FOCUS 顶层：聚焦区和「接下来」的分界也算一格（见 outline.moveStep）
    const step = moveStep(todos, id, e.key === 'ArrowUp' ? -1 : 1);
    if (step === null) {
      shake(el.closest('[data-edit-id]'));
      return true;
    }
    s.relocating = true;
    s.start = el.selectionStart;
    s.end = el.selectionEnd;
    setExitMode(id, 'instant');
    store.reorder(id, step.to, step.focused);
    refocus(`[data-editor="${CSS.escape(id)}"]`, s.start, s.end);
    return true;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    const up = e.key === 'ArrowUp';
    const len = el.value.length;
    const atEdge = up ? el.selectionStart === 0 && el.selectionEnd === 0 : el.selectionStart === len && el.selectionEnd === len;
    if (!atEdge) return false;
    const target = neighbor(el, id, up ? -1 : 1);
    if (!target) return false;
    e.preventDefault();
    finishEdit(true);
    if (target === DRAFT_ID) refocus(`[data-editor="${DRAFT_ID}"]`, up ? draftText.length : 0, up ? draftText.length : 0);
    else beginEdit(target, up ? 'end' : 'start');
    return true;
  }
  return false;
}

// ---------- 空行 ----------

export function onDraftKey(e: KeyboardEvent<HTMLTextAreaElement>, el: HTMLTextAreaElement): boolean {
  if (composing(e)) return false;
  const d = useUi.getState().draft;
  if (!d) return false;
  const todos = useData.getState().todos;
  const text = el.value;

  const relocate = (nd: Draft | null) => {
    if (!nd) {
      shake(el.closest('[data-edit-id]'));
      return;
    }
    draftRelocating = true;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    openDraft(nd, true);
    refocus(`[data-editor="${DRAFT_ID}"]`, start, end);
  };

  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    if (!text.trim()) {
      closeDraft();
      return true;
    }
    const id = commitDraft(d, text);
    draftText = '';
    if (id) relocate({ ...d, afterId: id });
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDraft();
    return true;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    relocate(e.shiftKey ? draftOutdent(todos, d) : draftIndent(todos, d));
    return true;
  }
  if (e.key === 'Backspace' && text === '') {
    e.preventDefault();
    const back = draftBackTarget(d);
    closeDraft();
    if (back) beginEdit(back, 'end');
    return true;
  }
  if (isMove(e) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    relocate(draftShift(todos, d, e.key === 'ArrowUp' ? -1 : 1));
    return true;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    const up = e.key === 'ArrowUp';
    const len = text.length;
    const atEdge = up ? el.selectionStart === 0 && el.selectionEnd === 0 : el.selectionStart === len && el.selectionEnd === len;
    if (!atEdge) return false;
    const target = neighbor(el, DRAFT_ID, up ? -1 : 1);
    if (!target) return false;
    e.preventDefault();
    draftRelocating = true; // 下面自己处理，不走失焦
    commitDraft(d, text);
    closeDraft();
    beginEdit(target, up ? 'end' : 'start');
    return true;
  }
  return false;
}
