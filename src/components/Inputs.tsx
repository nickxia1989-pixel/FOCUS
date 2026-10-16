import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useData, useUi } from '../store';
import { LISTS, type ListId, type Todo } from '../types';
import { PlusIcon } from './icons';

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** 列表顶部的新建输入框：回车新建并保持焦点，方便连续输入 */
export function AddBar({ list }: { list: ListId }) {
  const [text, setText] = useState('');
  const meta = LISTS.find((l) => l.id === list)!;

  const submit = () => {
    if (useData.getState().add(text, list)) setText('');
  };

  return (
    <div className="addbar">
      <PlusIcon className="addbar-icon" />
      <input
        id="add-input"
        className="addbar-input"
        value={text}
        placeholder={meta.placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setText('');
            e.currentTarget.blur();
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {text.trim() && (
        <button className="addbar-enter" onClick={submit} title="添加（回车）">
          ↵
        </button>
      )}
    </div>
  );
}

/** 父项下方的子 TODO 输入框 */
export function ChildAdder({ parent }: { parent: Todo }) {
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

  return (
    <div className="node child-adder">
      <div className="row">
        <span className="check check-ghost" />
        <input
          ref={ref}
          className="child-input"
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
      </div>
    </div>
  );
}

/** 双击标题后的原地编辑 */
export function TitleEditor({ todo }: { todo: Todo }) {
  const [text, setText] = useState(todo.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

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
    if (save) useData.getState().rename(todo.id, text);
    useUi.getState().set({ editingId: null });
  };

  return (
    <textarea
      ref={ref}
      className="title-editor"
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
      spellCheck={false}
    />
  );
}
