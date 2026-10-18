import { AnimatePresence } from 'motion/react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { deleteWithUndo, goView, sendToVerify, toggleTodo } from '../actions';
import { dragAttrs, startTreeDrag } from '../dnd';
import { DRAFT_ID } from '../editing';
import { withDraft } from '../outline';
import { runHandoff } from '../fx';
import { buildIndex, childrenOf, rootsOf, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { Todo } from '../types';
import { VIEW_COPY } from './copy';
import { CheckIcon, EyeCheckIcon, InboxIcon, PlusIcon, TrashIcon } from './icons';
import { AddBar, DraftEditor, DraftRow, NowAdder, TitleEditor } from './Inputs';
import { EmptyArt, DoneGroup } from './ListView';
import { draftKey, openMenuAt, presenceProps, startEdit, TodoNode } from './TodoNode';

/** NOW 卡的子任务默认全部显示；超过这么多条时可以收起 */
const FOLD_OVER = 8;
/** 收起时留几条 */
const FOLDED_SHOW = 4;

/** 队列逐行变淡：1 / .84 / .68 / .52 */
const fadeAt = (i: number) => Math.max(0.52, 1 - i * 0.16);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** NOW 卡上的一条子任务：勾选、双击编辑；悬停出现「待验证」开关和删除；右键是精简菜单 */
function NowSub({ todo, depth }: { todo: Todo; depth: number }) {
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const testing = !!todo.testing && !todo.done;
  return (
    <li
      className={`now-sub ${todo.done ? 'd' : ''} ${menuOpen ? 'menu-open' : ''} ${editing ? 'edit' : ''}`}
      style={{ paddingLeft: depth * 22 } as CSSProperties}
      data-node-id={todo.id}
      {...dragAttrs(todo, depth + 1, { indent: 22 })}
      onPointerDown={(e) => {
        // 卡片本身也能拖：子任务上按下的只拖子任务
        e.stopPropagation();
        startTreeDrag(e, todo);
      }}
      onContextMenu={(e) => openMenuAt(e, todo, false, 'nowSub')}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        startEdit(todo);
      }}
    >
      <button
        className={`sc ${todo.done ? 'd' : ''} ${testing ? 'v' : ''}`}
        role="checkbox"
        aria-checked={todo.done}
        title={todo.done ? '恢复为未完成' : '完成这个子任务'}
        onClick={() => toggleTodo(todo)}
      />
      <span className="tt" data-edit-id={todo.id}>
        {editing ? <TitleEditor todo={todo} /> : todo.title}
      </span>
      {testing && !editing && (
        <em role="button" title="待验证，点一下取消" onClick={() => sendToVerify(todo)}>
          待验证
        </em>
      )}
      {!editing && (
        <span className="sub-acts">
          <button
            className={`nmini ${testing ? 'on' : ''}`}
            title={testing ? '取消待验证' : '设为待验证（留在原处）'}
            aria-pressed={testing}
            onClick={(e) => sendToVerify(todo, e.currentTarget)}
          >
            <EyeCheckIcon />
          </button>
          <button className="nmini" title="删除" onClick={() => deleteWithUndo(todo)}>
            <TrashIcon />
          </button>
        </span>
      )}
    </li>
  );
}

/** 卡里的空行（编辑子任务时回车打开） */
function NowDraft({ depth }: { depth: number }) {
  return (
    <li className="now-sub draft" style={{ paddingLeft: depth * 22 } as CSSProperties} data-edit-id={DRAFT_ID}>
      <span className="sc" />
      <span className="tt">
        <DraftEditor placeholder="子任务，回车接着写下一条…" />
      </span>
    </li>
  );
}

/** 荧光绿的 NOW 卡：FOCUS 里手动顺序排第一的未完成顶层项 */
function NowCard({ todo, index, pos, total }: { todo: Todo; index: TreeIndex; pos: number; total: number }) {
  const ref = useRef<HTMLElement>(null);
  const kids = childrenOf(index, todo.id);
  const [folded, setFolded] = useState(false);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const draft = useUi((s) => s.draft);
  const dropNow = useUi((s) => s.dropNow);

  // 卡上显示整棵子树（缩进表示层级），空行插在它该在的位置
  const rows: ReactElement[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const c of withDraft(childrenOf(index, parentId), draft, todo.list, parentId)) {
      if (c === 'draft') rows.push(<NowDraft key={draftKey(draft!)} depth={depth} />);
      else {
        rows.push(<NowSub key={c.id} todo={c} depth={depth} />);
        walk(c.id, depth + 1);
      }
    }
  };
  walk(todo.id, 0);
  const canFold = rows.length > FOLD_OVER;
  const shown = canFold && folded ? rows.slice(0, FOLDED_SHOW) : rows;

  // 从队列行变形过来（换场 / 设为现在）
  useLayoutEffect(() => runHandoff(todo.id, ref.current), [todo.id]);

  return (
    <section
      ref={ref}
      className={`now ${completing ? 'is-completing' : ''} ${dropNow ? 'is-drop' : ''}`}
      data-now-id={todo.id}
      {...dragAttrs(todo, 0, { indent: 0 })}
      onPointerDown={(e) => startTreeDrag(e, todo)}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.now-sub')) return;
        openMenuAt(e, todo);
      }}
    >
      {/* 标题区：拖到这里 = 设为现在（摊平时 NOW 这一行的位置） */}
      <div className="now-head" data-drag-rect>
        <div className="now-top">
          <span>NOW · 现在就做这件</span>
          <span>
            {pad2(pos)}/{pad2(total)}
          </span>
        </div>
        <h2 className="now-title" onDoubleClick={() => startEdit(todo)} title="双击编辑" data-edit-id={todo.id}>
          {editing ? <TitleEditor todo={todo} /> : <span className="strike">{todo.title}</span>}
        </h2>
      </div>
      {kids.length >= 2 && (
        <div className="now-prog" aria-label={`子任务 ${kids.filter((k) => k.done).length}/${kids.length}`}>
          {[...kids.filter((k) => k.done), ...kids.filter((k) => !k.done)].map((k) => (
            <i key={k.id} className={k.done ? 'd' : ''} />
          ))}
        </div>
      )}
      <ul className="now-subs">
        {shown}
        {!(canFold && folded) && <NowAdder parent={todo} />}
      </ul>
      {canFold && (
        <button className="now-more" onClick={() => setFolded((v) => !v)}>
          {folded ? `展开全部 ${rows.length} 条` : '收起'}
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
  const draft = useUi((s) => (s.draft?.parentId === null && s.draft.list === 'focus' ? s.draft : null));
  let n = 1;

  return (
    <>
      {now ? <NowCard key={now.id} todo={now} index={index} pos={1} total={open.length} /> : <EmptyFocus />}
      {(now || compose) && <AddBar list="focus" autoFocus={!now && compose} />}
      {(queue.length > 0 || draft) && (
        <div className="qh">
          <span>
            <b>接下来</b> · {queue.length}
          </span>
          <span>拖到顶上 = 换成现在</span>
        </div>
      )}
      <div className="rows queue" style={{ '--c': 'var(--tx)' } as CSSProperties}>
        <AnimatePresence {...presenceProps}>
          {withDraft(queue, draft, 'focus', null).map((t) => {
            if (t === 'draft') return <DraftRow key={draftKey(draft!)} />;
            const i = n++;
            return <TodoNode key={t.id} todo={t} depth={0} index={index} variant="queue" no={i + 1} fade={fadeAt(i - 1)} />;
          })}
        </AnimatePresence>
        <DoneGroup list="focus" done={done} index={index} />
      </div>
    </>
  );
}
