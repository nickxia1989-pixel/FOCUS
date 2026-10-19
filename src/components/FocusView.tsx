import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { deleteWithUndo, goView, sendToVerify, setNow, toggleTodo } from '../actions';
import { dragAttrs, startTreeDrag } from '../dnd';
import { DRAFT_ID, startAddChild } from '../editing';
import { withDraft } from '../outline';
import { runZoneEnter } from '../fx';
import { buildIndex, childrenOf, rootsOf, type TreeIndex } from '../model';
import { useData, useUi } from '../store';
import type { Todo } from '../types';
import { VIEW_COPY } from './copy';
import { CheckIcon, EyeCheckIcon, GripIcon, InboxIcon, MoreIcon, PlusIcon, SparkFilledIcon, TrashIcon, UpIcon } from './icons';
import { AddBar, DraftEditor, DraftRow, TitleEditor } from './Inputs';
import { EmptyArt, DoneGroup } from './ListView';
import { draftKey, nodeVariants, openMenuAt, presenceProps, startEdit, TodoNode } from './TodoNode';

/** 聚焦项的子任务默认全部显示；超过这么多条时可以收起 */
const FOLD_OVER = 8;
/** 收起时留几条 */
const FOLDED_SHOW = 4;
/** 子任务每深一级往右缩多少 */
const SUB_INDENT = 24;

/** 队列逐行变淡：1 / .84 / .68 / .52 */
const fadeAt = (i: number) => Math.max(0.52, 1 - i * 0.16);

/** 聚焦项下的一条子任务：勾选（和普通行同一套完成动画）、双击编辑；悬停出现「待验证」开关和删除；右键是精简菜单 */
function ZoneSub({ todo, depth }: { todo: Todo; depth: number }) {
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const checked = todo.done || completing;
  const testing = !!todo.testing && !checked;
  return (
    <li
      className={['zsub', todo.done && !completing && 'd', completing && 'completing', menuOpen && 'menu-open', editing && 'edit'].filter(Boolean).join(' ')}
      style={{ paddingLeft: depth * SUB_INDENT } as CSSProperties}
      data-node-id={todo.id}
      {...dragAttrs(todo, depth + 1, { indent: SUB_INDENT })}
      onPointerDown={(e) => {
        // 聚焦项本身也能拖：子任务上按下的只拖子任务
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
        className={`zcb ${checked && !completing ? 'd' : ''} ${testing ? 'v' : ''}`}
        data-cb-id={todo.id}
        role="checkbox"
        aria-checked={checked}
        title={todo.done ? '恢复为未完成' : '完成这个子任务'}
        onClick={() => toggleTodo(todo)}
      >
        <CheckIcon />
      </button>
      <span className="tt" data-edit-id={todo.id}>
        {editing ? <TitleEditor todo={todo} /> : <span className="tt-text">{todo.title}</span>}
      </span>
      {testing && !editing && (
        <button className="ztag" title="待验证，点一下取消" onClick={() => sendToVerify(todo)}>
          待验证
        </button>
      )}
      {!editing && (
        <span className="sub-acts">
          <button
            className={`zmini ${testing ? 'on' : ''}`}
            title={testing ? '取消待验证' : '设为待验证（留在原处）'}
            aria-pressed={testing}
            onClick={(e) => sendToVerify(todo, e.currentTarget)}
          >
            <EyeCheckIcon />
          </button>
          <button className="zmini" title="删除" onClick={() => deleteWithUndo(todo)}>
            <TrashIcon />
          </button>
        </span>
      )}
    </li>
  );
}

/** 聚焦项里的空行（编辑子任务时回车打开） */
function SubDraft({ depth }: { depth: number }) {
  return (
    <li className="zsub draft" style={{ paddingLeft: depth * SUB_INDENT } as CSSProperties} data-edit-id={DRAFT_ID}>
      <span className="zcb" />
      <span className="tt">
        <DraftEditor placeholder="子任务，回车接着写下一条…" />
      </span>
    </li>
  );
}

/** 聚焦区里的空行（编辑聚焦项的标题时回车打开：新的一条也在聚焦区） */
function ZoneDraft() {
  return (
    <div className="znode">
      <div className="zitem draft">
        <div className="zhead" data-edit-id={DRAFT_ID}>
          <span className="zring" />
          <h3 className="ztitle">
            <DraftEditor placeholder="接着写下一件要盯着的事…" />
          </h3>
        </div>
      </div>
    </div>
  );
}

/**
 * 聚焦区里的一件事：完成圈 + 标题（荧光笔）+ 送去验证；子任务、进度在下面。
 * 悬停时出现的 ↑ / + / ⋯ 浮在标题行右侧、不占位置，悬停前后布局完全不变；点 + 才在子任务最后开一个空行。
 */
function ZoneItem({ todo, index, first }: { todo: Todo; index: TreeIndex; first: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const kids = childrenOf(index, todo.id);
  const [folded, setFolded] = useState(false);
  const completing = useUi((s) => !!s.completing[todo.id]);
  const editing = useUi((s) => s.editingId === todo.id);
  const menuOpen = useUi((s) => s.menu?.todoId === todo.id);
  const flash = useUi((s) => !!s.flash[todo.id]);
  const draft = useUi((s) => s.draft);
  const variants = useMemo(() => nodeVariants(todo.id), [todo.id]);

  // 显示整棵子树（缩进表示层级），空行插在它该在的位置
  const rows: ReactElement[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const c of withDraft(childrenOf(index, parentId), draft, todo.list, parentId)) {
      if (c === 'draft') rows.push(<SubDraft key={draftKey(draft!)} depth={depth} />);
      else {
        rows.push(<ZoneSub key={c.id} todo={c} depth={depth} />);
        walk(c.id, depth + 1);
      }
    }
  };
  walk(todo.id, 0);
  const canFold = rows.length > FOLD_OVER;
  const shown = canFold && folded ? rows.slice(0, FOLDED_SHOW) : rows;
  const doneKids = kids.filter((k) => k.done).length;

  // 从「接下来」那一行移上来（设为现在、放进下一件）或新建时弹出来
  useLayoutEffect(() => runZoneEnter(todo.id, ref.current), [todo.id]);

  return (
    <motion.div layout="position" variants={variants} initial="initial" animate="enter" exit="exit" className="znode">
      <div
        ref={ref}
        className={['zitem', completing && 'is-completing', menuOpen && 'menu-open', editing && 'edit', flash && 'flash'].filter(Boolean).join(' ')}
        data-zone-item={todo.id}
        data-node-id={todo.id}
        {...dragAttrs(todo, 0, { indent: 32 })}
        onPointerDown={(e) => startTreeDrag(e, todo)}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.zsub')) return;
          openMenuAt(e, todo);
        }}
      >
        <span className="grip">
          <GripIcon />
        </span>
        {/* 标题行：拖拽时的落点按这一行算 */}
        <div className="zhead" data-drag-rect>
          <button className="zring" data-cb-id={todo.id} role="checkbox" aria-checked={completing} title="完成这一件" onClick={() => toggleTodo(todo)}>
            <CheckIcon />
          </button>
          <h3 className="ztitle" onDoubleClick={() => startEdit(todo)} title="双击编辑" data-edit-id={todo.id}>
            {editing ? <TitleEditor todo={todo} /> : <span className="mark">{todo.title}</span>}
          </h3>
          {!editing && (
            <span className="zacts">
              <span className="zhov">
                {!first && (
                  <button className="zmini" title="设为现在（移到聚焦区最前）" onClick={() => setNow(todo)}>
                    <UpIcon />
                  </button>
                )}
                <button className="zmini" title="添加子任务" onClick={() => startAddChild(todo.id)}>
                  <PlusIcon />
                </button>
                <button className="zmini" title="更多操作" onClick={(e) => openMenuAt(e, todo, true)}>
                  <MoreIcon />
                </button>
              </span>
              <button className="zmini" title="做完了，送去验证" onClick={(e) => sendToVerify(todo, e.currentTarget)}>
                <EyeCheckIcon />
              </button>
            </span>
          )}
        </div>
        {kids.length >= 2 && (
          <div className="zprog" aria-label={`子任务 ${doneKids}/${kids.length}`}>
            <span className="bars">
              {[...kids.filter((k) => k.done), ...kids.filter((k) => !k.done)].map((k) => (
                <i key={k.id} className={k.done ? 'd' : ''} />
              ))}
            </span>
            <span className="cnt">
              {doneKids}/{kids.length}
            </span>
          </div>
        )}
        {shown.length > 0 && <ul className="zsubs">{shown}</ul>}
        {canFold && (
          <button className="zmore" onClick={() => setFolded((v) => !v)}>
            {folded ? `展开全部 ${rows.length} 条` : '收起'}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** 聚焦区：同时盯着的几件事。拖进来、拖出去、在里面排序都走自由拖拽（src/dnd.ts） */
function FocusZone({ zone, index }: { zone: Todo[]; index: TreeIndex }) {
  const drop = useUi((s) => s.dropZone);
  const draft = useUi((s) => (s.draft?.parentId === null && s.draft.list === 'focus' ? s.draft : null));
  const inZoneDraft = !!draft && (draft.afterId === null || zone.some((t) => t.id === draft.afterId));
  return (
    <section className={`zone ${drop ? 'is-drop' : ''}`} data-zone aria-label="聚焦区">
      <div className="zone-head">
        <span className="zone-label">
          <b className="now-tag">
            <SparkFilledIcon />
            NOW
          </b>
          <span>同时盯着 {zone.length} 件</span>
        </span>
        <span className={`zone-hint ${drop ? 'on' : ''}`}>{drop ? '松手 = 加入聚焦' : '拖动排序'}</span>
      </div>
      <div className="zitems">
        <AnimatePresence {...presenceProps}>
          {withDraft(zone, inZoneDraft ? draft : null, 'focus', null).map((t, i) =>
            t === 'draft' ? <ZoneDraft key={draftKey(draft!)} /> : <ZoneItem key={t.id} todo={t} index={index} first={i === 0} />,
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** 聚焦区空着（FOCUS 里还有事）：虚线框可以直接拖进来，或一键放进下一件 */
function EmptyZone({ next }: { next: Todo }) {
  const drop = useUi((s) => s.dropZone);
  return (
    <section className={`zone-empty ${drop ? 'is-drop' : ''}`} data-zone aria-label="聚焦区（空）">
      <span className="ze-icon">
        <SparkFilledIcon />
      </span>
      <b>聚焦区空着</b>
      <p>把要一起盯着的几件事拖进来，或在「接下来」里点 ↑</p>
      <button className="ze-next" onClick={() => setNow(next)} title="放进聚焦区">
        <UpIcon />
        <span>放进下一件：{next.title}</span>
      </button>
    </section>
  );
}

function EmptyFocus() {
  const copy = VIEW_COPY.focus;
  return (
    <div className="empty" data-zone>
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

/** FOCUS：聚焦区 → 新建框 → 接下来 */
export function FocusView() {
  const todos = useData((s) => s.todos);
  const compose = useUi((s) => s.composeFocus);
  const index = useMemo(() => buildIndex(todos), [todos]);
  const roots = rootsOf(index, 'focus');
  const open = roots.filter((t) => !t.done);
  const done = roots.filter((t) => t.done);
  // 聚焦区排在前面（见 model.compareTodos）
  const zone = open.filter((t) => t.focused);
  const queue = open.filter((t) => !t.focused);
  const draft = useUi((s) => (s.draft?.parentId === null && s.draft.list === 'focus' ? s.draft : null));
  // 空行跟在聚焦项后面时画在聚焦区里，其余的画在「接下来」
  const queueDraft = draft && !(draft.afterId === null ? zone.length > 0 : zone.some((t) => t.id === draft.afterId)) ? draft : null;
  let n = 0;

  return (
    <>
      {open.length === 0 ? <EmptyFocus /> : zone.length ? <FocusZone zone={zone} index={index} /> : <EmptyZone next={queue[0]} />}
      {(open.length > 0 || compose) && <AddBar list="focus" autoFocus={!open.length && compose} />}
      {(queue.length > 0 || queueDraft) && (
        <div className="qh">
          <span>
            <b>接下来</b> · {queue.length}
          </span>
          <span>拖到上面 = 一起盯着</span>
        </div>
      )}
      <div className="rows queue" data-queue style={{ '--c': 'var(--tx)' } as CSSProperties}>
        <AnimatePresence {...presenceProps}>
          {withDraft(queue, queueDraft, 'focus', null).map((t) => {
            if (t === 'draft') return <DraftRow key={draftKey(queueDraft!)} />;
            const k = n++;
            return <TodoNode key={t.id} todo={t} depth={0} index={index} variant="queue" no={zone.length + k + 1} fade={fadeAt(k)} />;
          })}
        </AnimatePresence>
        <DoneGroup list="focus" done={done} index={index} />
      </div>
    </>
  );
}
