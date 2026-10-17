import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addTodo } from '../actions';
import { isMac } from '../platform';
import { useData, useUi } from '../store';
import type { ListId, Todo } from '../types';
import { VIEW_COPY } from './copy';
import { PlusIcon } from './icons';

export const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * 列表顶部的新建框：回车新建并保持焦点，方便连续输入。
 * FOCUS 里新建的排在 NOW 之后；⌘/Ctrl + 回车 = 新建并设为现在。
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
      {list === 'focus' && text.trim() && <kbd title="新建并设为现在">{MOD}↵ 设为现在</kbd>}
    </label>
  );
}

/** 父项下方的子任务输入框；inCard：放在 NOW 卡里 */
export function ChildAdder({ parent, inCard }: { parent: Todo; inCard?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const close = () => useUi.getState().set({ addingChildOf: null });
  const submit = () => {
    if (useData.getState().add(text, parent.list, parent.id)) setText('');
  };

  const input = (
    <input
      ref={ref}
      value={text}
      placeholder="子任务，回车添加…"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') {
          cancelled.current = true;
          close();
        }
      }}
      onBlur={() => {
        // 点到别处时保留已输入的内容；按 Esc 则放弃
        if (!cancelled.current && text.trim()) useData.getState().add(text, parent.list, parent.id);
        close();
      }}
      autoComplete="off"
      spellCheck={false}
    />
  );

  if (inCard)
    return (
      <li className="now-sub now-adder">
        <span className="sc" />
        {input}
      </li>
    );

  return (
    <div className="node child-adder">
      <div className="row">
        <span className="cb" />
        {input}
      </div>
    </div>
  );
}

/** 双击标题后的原地编辑 */
export function TitleEditor({ todo }: { todo: Todo }) {
  const [text, setText] = useState(todo.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  // 开始编辑时的知识：编辑期间远端改了这条标题，提交时会变成冲突而不是盖掉远端
  const base = useRef(useData.getState().clock.knowledge);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    fit();
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && text.trim() !== todo.title) useData.getState().rename(todo.id, text, base.current);
    useUi.getState().set({ editingId: null });
  };

  return (
    <textarea
      ref={ref}
      value={text}
      rows={1}
      onChange={(e) => {
        setText(e.target.value.replace(/\n/g, ' '));
        fit();
      }}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        }
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}
