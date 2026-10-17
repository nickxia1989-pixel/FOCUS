import { AnimatePresence } from 'motion/react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { goView, sendToVerify, toggleTodo } from '../actions';
import { runHandoff } from '../fx';
import { buildIndex, childrenOf, rootsOf, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { Todo } from '../types';
import { VIEW_COPY } from './copy';
import { CheckIcon, EyeCheckIcon, InboxIcon, PlusIcon } from './icons';
import { AddBar, ChildAdder, TitleEditor } from './Inputs';
import { EmptyArt, DoneGroup } from './ListView';
import { openMenuAt, presenceProps, startEdit, TodoNode } from './TodoNode';

/** NOW 卡上最多列几条子任务（未完成在前） */
const SUB_LIMIT = 3;

/** 队列逐行变淡：1 / .84 / .68 / .52 */
const fadeAt = (i: number) => Math.max(0.52, 1 - i * 0.16);

const pad2 = (n: number) => String(n).padStart(2, '0');

function NowSub({ todo }: { todo: Todo }) {
  const editing = useUi((s) => s.editingId === todo.id);
  const testing = !!todo.testing && !todo.done;
  return (
    <li
      className={`now-sub ${todo.done ? 'd' : ''}`}
      onContextMenu={(e) => openMenuAt(e, todo)}
      onDoubleClick={() => startEdit(todo)}
    >
      <button
        className={`sc ${todo.done ? 'd' : ''} ${testing ? 'v' : ''}`}
        role="checkbox"
        aria-checked={todo.done}
        title={todo.done ? '恢复为未完成' : '完成这个子任务'}
        onClick={() => toggleTodo(todo)}
      />
      {editing ? <TitleEditor todo={todo} /> : <span className="tt">{todo.title}</span>}
      {testing && (
        <em role="button" title="待验证，点一下取消" onClick={() => sendToVerify(todo)}>
          待验证
        </em>
      )}
    </li>
  );
}

/** 荧光绿的 NOW 卡：FOCUS 里手动顺序排第一的未完成顶层项 */
function NowCard({ todo, index, pos, total }: { todo: Todo; index: TreeIndex; pos: number; total: number }) {
  const ref = useRef<HTMLElement>(null);
  const kids = childrenOf(index, todo.id);
  const [showAll, setShowAll] = useState(false);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const addingChild = useUi((s) => s.addingChildOf === todo.id);
  const dropNow = useUi((s) => s.dropNow);
  const shown = showAll ? kids : kids.slice(0, SUB_LIMIT);
  const more = kids.length - shown.length;

  // 从队列行变形过来（换场 / 设为现在）
  useLayoutEffect(() => runHandoff(todo.id, ref.current), [todo.id]);

  return (
    <section
      ref={ref}
      className={`now ${completing ? 'is-completing' : ''} ${dropNow ? 'is-drop' : ''}`}
      data-now-id={todo.id}
      data-drop-now
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.now-sub')) return;
        openMenuAt(e, todo);
      }}
    >
      <div className="now-top">
        <span>NOW · 现在就做这件</span>
        <span>
          {pad2(pos)}/{pad2(total)}
        </span>
      </div>
      <h2 className="now-title" onDoubleClick={() => startEdit(todo)} title="双击编辑">
        {editing ? <TitleEditor todo={todo} /> : <span className="strike">{todo.title}</span>}
      </h2>
      {kids.length >= 2 && (
        <div className="now-prog" aria-label={`子任务 ${kids.filter((k) => k.done).length}/${kids.length}`}>
          {[...kids.filter((k) => k.done), ...kids.filter((k) => !k.done)].map((k) => (
            <i key={k.id} className={k.done ? 'd' : ''} />
          ))}
        </div>
      )}
      {(shown.length > 0 || addingChild) && (
        <ul className="now-subs">
          {shown.map((k) => (
            <NowSub key={k.id} todo={k} />
          ))}
          {addingChild && <ChildAdder parent={todo} inCard />}
        </ul>
      )}
      {more > 0 && (
        <button className="now-more" onClick={() => setShowAll(true)}>
          还有 {more} 条
        </button>
      )}
      {showAll && kids.length > SUB_LIMIT && (
        <button className="now-more" onClick={() => setShowAll(false)}>
          收起
        </button>
      )}
      <div className="now-act">
        <button className="now-done" title="完成这一件" onClick={() => toggleTodo(todo)}>
          <CheckIcon />
        </button>
        <b role="button" onClick={() => toggleTodo(todo)}>
          完成
        </b>
        <button className="now-verify" title="做完了，还要测一下" onClick={(e) => sendToVerify(todo, e.currentTarget)}>
          <EyeCheckIcon />
          送去验证
        </button>
      </div>
    </section>
  );
}

function EmptyFocus() {
  const copy = VIEW_COPY.focus;
  return (
    <div className="empty">
      <EmptyArt />
      <b>{copy.emptyTitle}</b>
      <p>{copy.emptyText}</p>
      <div className="btns">
        <button className="btn lime" onClick={() => goView('inbox')}>
          <InboxIcon />
          去 INBOX 挑一件
        </button>
        <button className="btn" onClick={() => useUi.getState().set({ composeFocus: true })}>
          <PlusIcon />
          写一件
        </button>
      </div>
    </div>
  );
}

/** FOCUS：NOW 卡 → 新建框 → 接下来 */
export function FocusView() {
  const todos = useData((s) => s.todos);
  const compose = useUi((s) => s.composeFocus);
  const index = useMemo(() => buildIndex(todos), [todos]);
  const roots = rootsOf(index, 'focus');
  const open = roots.filter((t) => !t.done);
  const done = roots.filter((t) => t.done);
  const now = open[0];
  const queue = open.slice(1);

  return (
    <>
      {now ? <NowCard key={now.id} todo={now} index={index} pos={1} total={open.length} /> : <EmptyFocus />}
      {(now || compose) && <AddBar list="focus" autoFocus={!now && compose} />}
      {queue.length > 0 && (
        <div className="qh">
          <span>
            <b>接下来</b> · {queue.length}
          </span>
          <span>拖到顶上 = 换成现在</span>
        </div>
      )}
      <div className="rows queue" style={{ '--c': 'var(--tx)' } as CSSProperties}>
        <AnimatePresence {...presenceProps}>
          {queue.map((t, i) => (
            <TodoNode key={t.id} todo={t} depth={0} index={index} siblings={queue} variant="queue" no={i + 2} fade={fadeAt(i)} />
          ))}
        </AnimatePresence>
        <DoneGroup list="focus" done={done} index={index} roots={roots} />
      </div>
    </>
  );
}
