import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addTodo } from '../actions';
import { isMac } from '../platform';
import { useData } from '../store';
import { attachSession, blurDraft, DRAFT_ID, finishEdit, getDraftText, isDraftRelocating, onDraftKey, onEditKey, setDraftText } from '../editing';
import type { ListId, Todo } from '../types';
import { VIEW_COPY } from './copy';
import { PlusIcon } from './icons';

export const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * 列表顶部的新建框：回车新建并保持焦点，方便连续输入。
 * FOCUS 里新建的排在聚焦区后面（「接下来」第一位）；⌘/Ctrl + 回车 = 新建并放进聚焦区最前。
 */
export function AddBar({ list, autoFocus }: { list: ListId; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const submit = (top: boolean) => {
    if (addTodo(text, list, top && list === 'focus')) setText('');
  };

  return (
    <label className="add">
      <PlusIcon />
      <input
        ref={ref}
        id="add-input"
        value={text}
        placeholder={VIEW_COPY[list].placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(isMac ? e.metaKey : e.ctrlKey);
          }
          if (e.key === 'Escape') {
            setText('');
            e.currentTarget.blur();
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {list === 'focus' && text.trim() && <kbd title="新建并放进聚焦区">{MOD}↵ 放进聚焦</kbd>}
    </label>
  );
}

/** 自动撑高的单行标题输入（编辑框和空行共用） */
function useAutoFit() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };
  return [ref, fit] as const;
}

/**
 * 双击标题后的原地编辑。按键规则见 src/editing.ts（回车开下一行、Tab 缩进、⌥⇧↑↓ 移动、↑↓ 跳到上一条 / 下一条）。
 * 换位置（缩进、移动）时编辑框会重新挂载，文字和光标从会话里接上。
 */
export function TitleEditor({ todo }: { todo: Todo }) {
  const [sess] = useState(() => attachSession(todo.id, todo.title));
  const [text, setText] = useState(sess.text);
  const [ref, fit] = useAutoFit();

  useLayoutEffect(() => {
    fit();
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(sess.start, sess.end);
  }, []);

  return (
    <textarea
      ref={ref}
      data-editor={todo.id}
      value={text}
      rows={1}
      onChange={(e) => {
        const v = e.target.value.replace(/\n/g, ' ');
        setText(v);
        sess.text = v;
        fit();
      }}
      onSelect={(e) => {
        sess.start = e.currentTarget.selectionStart;
        sess.end = e.currentTarget.selectionEnd;
      }}
      onKeyDown={(e) => {
        onEditKey(e, todo.id, e.currentTarget);
      }}
      onBlur={() => {
        if (!sess.relocating) finishEdit(true);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}

/**
 * 空行：编辑时回车打开，还没真正新建。有内容再回车才新建，接着在后面再开一行；
 * Tab / Shift+Tab 改它将来的层级；空着按退格回到上一条。
 */
export function DraftEditor({ placeholder = '接着写下一条…' }: { placeholder?: string }) {
  const [text, setText] = useState(getDraftText);
  const [ref, fit] = useAutoFit();

  useLayoutEffect(() => {
    fit();
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.closest('[data-edit-id]')?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <textarea
      ref={ref}
      data-editor={DRAFT_ID}
      value={text}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value.replace(/\n/g, ' ');
        setText(v);
        setDraftText(v);
        fit();
      }}
      onKeyDown={(e) => {
        onDraftKey(e, e.currentTarget);
      }}
      onBlur={() => {
        if (!isDraftRelocating()) blurDraft();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}

/** 列表里的空行（行的样子） */
export function DraftRow() {
  return (
    <div className="node draft-node">
      <div className="row draft" data-edit-id={DRAFT_ID}>
        <span className="cb" />
        <span className="tt">
          <DraftEditor />
        </span>
      </div>
    </div>
  );
}

/**
 * 聚焦项子任务列表底部的「+ 添加子任务」（悬停这一件时出现）：回车添加后不关，可以连续加，新加的排在最后。
 */
export function SubAdder({ parent }: { parent: Todo }) {
  const [text, setText] = useState('');
  return (
    <li className={`zsub zadder ${text ? 'has-text' : ''}`}>
      <PlusIcon className="plus" />
      <input
        value={text}
        placeholder="添加子任务"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            const id = useData.getState().add(text, parent.list, parent.id);
            if (id) setText('');
          }
          if (e.key === 'Escape') {
            setText('');
            e.currentTarget.blur();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        autoComplete="off"
        spellCheck={false}
      />
    </li>
  );
}
