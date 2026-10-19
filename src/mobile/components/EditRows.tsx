// 编辑时用到的两样东西：回车开出来的空行（DraftRow），和软键盘上方的玻璃工具条（EditBar）
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  backFromDraft,
  closeDraft,
  commitDraft,
  endEditing,
  getDraftText,
  indentDraft,
  indentItem,
  isHandingOver,
  moveItem,
  outdentDraft,
  outdentItem,
  revealInput,
  setDraftText,
  shake,
} from '../edit';
import { DownIcon, IndentIcon, OutdentIcon, UpIcon } from '../icons';
import { useTodos } from '../store';
import { useKeyboardUp } from './Composer';
import { useRefitOnWidth, useUi } from '../ui';

/** 拼音等输入法组字时的按键只是上屏（Safari 里 isComposing 可能为 false，但 keyCode 是 229） */
export const composing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** iOS 上点空白处输入框不会失焦：点到编辑框和工具条以外的地方都结束编辑 */
export function useBlurOnOutside(ref: React.RefObject<HTMLTextAreaElement | null>, onOutside: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      const t = e.target as Element;
      if (!el || el.contains(t) || t.closest?.('.edit-bar')) return;
      if (document.activeElement === el) el.blur();
      else onOutside();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * 空行：还没建的条目。有内容 Enter 新建并接着开下一行；空着 Enter 结束；删除键回到上一条；Tab 调层级。
 * kind 决定长得像哪种行：列表行、「接下来」的行、聚焦区里的一件、聚焦项下的子任务
 */
export function DraftRow({ kind, depth = 0 }: { kind: 'row' | 'q' | 'zone' | 'sub'; depth?: number }) {
  const draft = useUi((s) => s.draft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(fit, [fit]);
  useRefitOnWidth(ref, fit);
  useBlurOnOutside(ref, () => commitDraft(ref.current?.value ?? '', false));
  if (!draft) return null;

  const input = (
    <textarea
      ref={ref}
      className="row-edit"
      data-draft-input
      rows={1}
      defaultValue={getDraftText()}
      placeholder={kind === 'sub' ? '子任务…' : kind === 'zone' ? '接着写下一件要盯着的事…' : '接着写…'}
      enterKeyHint="next"
      onInput={(e) => {
        fit();
        setDraftText(e.currentTarget.value);
      }}
      onFocus={() => setTimeout(() => revealInput(ref.current), 320)}
      onBlur={(e) => {
        if (!isHandingOver()) commitDraft(e.currentTarget.value, false);
      }}
      onKeyDown={(e) => {
        if (composing(e)) return;
        const value = e.currentTarget.value;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (value.trim()) commitDraft(value, true);
          else e.currentTarget.blur();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) outdentDraft();
          else indentDraft();
        } else if (e.key === 'Backspace' && value === '') {
          e.preventDefault();
          backFromDraft();
        } else if (e.key === 'Escape') {
          closeDraft();
        }
      }}
    />
  );

  const style = { '--depth': depth, '--c': `var(--c-${draft.list})` } as CSSProperties;
  if (kind === 'q')
    return (
      <div className="q-row is-draft" data-draft-row style={style}>
        <span className="q-no">＋</span>
        <span className="q-title">{input}</span>
      </div>
    );
  if (kind === 'zone')
    return (
      <div className="zhead is-draft" data-draft-row style={style}>
        <span className="zring" />
        <span className="ztitle">{input}</span>
      </div>
    );
  if (kind === 'sub')
    return (
      <div className="zsub is-draft" data-draft-row style={style}>
        <span className="zcb" />
        <span className="zsub-text">{input}</span>
      </div>
    );
  return (
    <div className="row is-draft" data-draft-row style={style}>
      <span className="check" />
      <div className="row-main">{input}</div>
    </div>
  );
}

/** 编辑标题时键盘上方的玻璃工具条：反缩进 / 缩进 / 上移 / 下移 / 完成 */
export function EditBar() {
  const editingId = useUi((s) => s.editingId);
  const draft = useUi((s) => s.draft);
  const todos = useTodos();
  const todo = editingId ? todos.find((t) => t.id === editingId) : undefined;
  const active = useEditFocus();
  const kb = useKeyboardUp();
  const [side, setSide] = useState<CSSProperties>({});

  // 双页时工具条放在正在编辑的那一页，不压折痕
  useLayoutEffect(() => {
    const app = document.querySelector<HTMLElement>('.app.is-spread');
    const input = document.querySelector('[data-edit-input], [data-draft-input]');
    if (!app || !input) return setSide({});
    const cs = getComputedStyle(app);
    const leftEnd = parseFloat(cs.getPropertyValue('--page-l-end'));
    const rightStart = parseFloat(cs.getPropertyValue('--page-r-start'));
    const r = input.getBoundingClientRect();
    if (!leftEnd || !rightStart) return setSide({});
    setSide(r.left + r.width / 2 < leftEnd ? { left: 12, right: window.innerWidth - leftEnd + 12 } : { left: rightStart + 12, right: 12 });
  }, [active, editingId, draft]);

  if (!active || (!todo && !draft)) return null;
  // 按钮上按下时别让编辑框失焦
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const run = (fn: () => void) => () => fn();
  const items = [
    { key: 'out', label: '反缩进', icon: <OutdentIcon />, run: () => (todo ? outdentItem(todo) : outdentDraft()) },
    { key: 'in', label: '缩进', icon: <IndentIcon />, run: () => (todo ? indentItem(todo) : indentDraft()) },
    { key: 'up', label: '上移', icon: <UpIcon />, run: () => (todo ? moveItem(todo, -1) : shake('draft')) },
    { key: 'down', label: '下移', icon: <DownIcon />, run: () => (todo ? moveItem(todo, 1) : shake('draft')) },
  ];
  return (
    <div
      className="edit-bar glass"
      role="toolbar"
      aria-label="调整层级"
      // 软键盘起来时贴着键盘；没有软键盘（外接键盘、浏览器）时浮在页签栏上面
      style={kb ? { ...side, bottom: 'calc(var(--kb) + 8px)' } : side}
    >
      {items.map((it) => (
        <button key={it.key} aria-label={it.label} title={it.label} onPointerDown={keep} onMouseDown={keep} onClick={run(it.run)}>
          {it.icon}
        </button>
      ))}
      <button className="edit-done" onPointerDown={keep} onMouseDown={keep} onClick={endEditing}>
        完成
      </button>
    </div>
  );
}

/** 焦点在标题编辑框 / 空行里 */
function useEditFocus() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(!!document.activeElement?.matches('[data-edit-input], [data-draft-input]'));
    // focusout 时 activeElement 还没换好，等这一轮事件走完再读
    const later = () => queueMicrotask(read);
    document.addEventListener('focusin', later);
    document.addEventListener('focusout', later);
    read();
    return () => {
      document.removeEventListener('focusin', later);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return on;
}
