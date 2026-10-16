import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { restoreFromTrash } from '../actions';
import { startOfToday } from '../model';
import { useData, useUi } from '../store';
import { TRASH_KEEP_DAYS } from '../trash';
import { LISTS, type Todo, type TrashEntry } from '../types';
import { BackIcon, TrashIcon, UndoIcon } from './icons';

const DAY = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

function relTime(t: number, now: number) {
  const d = now - t;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  const date = new Date(t);
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = startOfToday(now);
  if (t >= today) return `今天 ${hm}`;
  if (t >= today - DAY) return `昨天 ${hm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

/** 二次确认按钮：第一次点进入确认态，3 秒内再点才执行 */
function useConfirm(onConfirm: () => void) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const click = () => {
    if (armed) {
      setArmed(false);
      onConfirm();
    } else setArmed(true);
  };
  return [armed, click] as const;
}

/** 子孙按层级摊平，用于预览 */
function flattenChildren(items: Todo[], rootId: string) {
  const byParent = new Map<string, Todo[]>();
  for (const t of items) {
    if (!t.parentId) continue;
    const arr = byParent.get(t.parentId);
    if (arr) arr.push(t);
    else byParent.set(t.parentId, [t]);
  }
  const out: { todo: Todo; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    const kids = (byParent.get(id) ?? []).sort((a, b) => b.order - a.order);
    for (const k of kids) {
      out.push({ todo: k, depth });
      walk(k.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

const PREVIEW_LINES = 4;

function TrashRow({ entry, now }: { entry: TrashEntry; now: number }) {
  const root = entry.items.find((t) => t.id === entry.rootId)!;
  const parent = useData((s) => (entry.parentId ? s.todos.find((t) => t.id === entry.parentId) : undefined));
  const list = LISTS.find((l) => l.id === (parent?.list ?? entry.list))!;
  const kids = useMemo(() => flattenChildren(entry.items, entry.rootId), [entry]);
  const [armed, purge] = useConfirm(() => useData.getState().purgeTrashEntry(entry.id));

  return (
    <motion.div
      layout="position"
      className="trash-row"
      exit={{ opacity: 0, x: 48, height: 0, transition: { duration: 0.28 } }}
    >
      <div className="trash-main">
        <div className={`trash-item-title ${root.done ? 'is-done' : ''}`}>{root.title}</div>
        {kids.length > 0 && (
          <ul className="trash-kids">
            {kids.slice(0, PREVIEW_LINES).map(({ todo, depth }) => (
              <li key={todo.id} className={todo.done ? 'is-done' : ''} style={{ paddingLeft: depth * 12 }}>
                {todo.title}
              </li>
            ))}
            {kids.length > PREVIEW_LINES && <li className="trash-more">…还有 {kids.length - PREVIEW_LINES} 项</li>}
          </ul>
        )}
        <div className="trash-meta">
          <span className={`trash-list trash-list-${list.id}`}>{list.label}</span>
          {parent && <span className="trash-parent">原属「{parent.title}」</span>}
          <span>{relTime(entry.deletedAt, now)}</span>
        </div>
      </div>
      <div className="trash-actions">
        <button className="trash-restore" title="恢复到原来的位置" onClick={() => restoreFromTrash(entry.id)}>
          <UndoIcon width={13} height={13} />
          恢复
        </button>
        <button
          className={`trash-purge ${armed ? 'is-armed' : ''}`}
          title={armed ? '再点一次彻底删除' : '彻底删除'}
          onClick={purge}
        >
          {armed ? '确认' : <TrashIcon width={14} height={14} />}
        </button>
      </div>
    </motion.div>
  );
}

function TrashSheet() {
  const trash = useData((s) => s.trash);
  const [now, setNow] = useState(() => Date.now());
  const close = () => useUi.getState().set({ trashOpen: false });
  const [armedAll, emptyAll] = useConfirm(() => useData.getState().emptyTrash());
  const sorted = useMemo(() => [...trash].sort((a, b) => b.deletedAt - a.deletedAt), [trash]);
  const itemCount = useMemo(() => trash.reduce((n, e) => n + e.items.length, 0), [trash]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUi.getState().menu) close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <motion.section
      className="trash"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 420, damping: 42 }}
    >
      <header className="trash-head">
        <button className="tb-btn" title="返回（Esc）" onClick={close}>
          <BackIcon />
        </button>
        <div className="trash-title">
          回收站
          {itemCount > 0 && <span className="trash-count">{itemCount}</span>}
        </div>
        {trash.length > 0 && (
          <button className={`trash-empty ${armedAll ? 'is-armed' : ''}`} onClick={emptyAll}>
            {armedAll ? '确认清空' : '清空'}
          </button>
        )}
      </header>
      <p className="trash-note">删除的条目在这里保留 {TRASH_KEEP_DAYS} 天，可以恢复到原来的位置。</p>
      <div className="trash-scroll">
        {sorted.length === 0 ? (
          <div className="empty">
            <TrashIcon className="empty-icon" width={34} height={34} />
            <p>回收站是空的。</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {sorted.map((e) => (
              <TrashRow key={e.id} entry={e} now={now} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </motion.section>
  );
}

/** 平时藏起来的回收站，从标题栏 ⋯ 菜单进入 */
export function TrashPanel() {
  const open = useUi((s) => s.trashOpen);
  return <AnimatePresence>{open && <TrashSheet />}</AnimatePresence>;
}
