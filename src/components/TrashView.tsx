import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { restoreFromTrash } from '../actions';
import { startOfToday } from '../model';
import { useData, useUi } from '../store';
import { TRASH_KEEP_DAYS } from '../trash';
import type { Todo, TrashEntry } from '../types';
import { LIST_COLOR, VIEW_COPY } from './copy';
import { TrashIcon } from './icons';
import { EmptyState } from './ListView';

const DAY = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

function deletedAt(t: number, now: number) {
  const date = new Date(t);
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = startOfToday(now);
  if (t >= today) return `今天 ${hm} 删除`;
  if (t >= today - DAY) return `昨天 ${hm} 删除`;
  return `${date.getMonth() + 1}月${date.getDate()}日删除`;
}

/** 二次确认：第一次点进入确认态，3 秒内再点才执行 */
export function useConfirm(onConfirm: () => void) {
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
function descendants(items: Todo[], rootId: string) {
  const byParent = new Map<string, Todo[]>();
  for (const t of items) {
    if (!t.parentId) continue;
    const arr = byParent.get(t.parentId);
    if (arr) arr.push(t);
    else byParent.set(t.parentId, [t]);
  }
  const out: Todo[] = [];
  const walk = (id: string) => {
    for (const k of (byParent.get(id) ?? []).sort((a, b) => b.order - a.order)) {
      out.push(k);
      walk(k.id);
    }
  };
  walk(rootId);
  return out;
}

function TrashCard({ entry, now }: { entry: TrashEntry; now: number }) {
  const root = entry.items.find((t) => t.id === entry.rootId)!;
  const parent = useData((s) => (entry.parentId ? s.todos.find((t) => t.id === entry.parentId) : undefined));
  const list = parent?.list ?? entry.list;
  const kids = useMemo(() => descendants(entry.items, entry.rootId), [entry]);
  const [armed, purge] = useConfirm(() => useData.getState().purgeTrashEntry(entry.id));
  const where = parent ? `原属「${parent.title}」` : `原在 ${VIEW_COPY[list].en}`;
  const preview = kids.slice(0, 3).map((k) => k.title).join('、') + (kids.length > 3 ? '…' : '');

  return (
    <motion.div
      layout="position"
      className="tr"
      style={{ '--c': LIST_COLOR[list] } as CSSProperties}
      exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.24 } }}
    >
      <b className={root.done ? 'done' : ''}>{root.title}</b>
      <div className="m">
        <i />
        {where} · {deletedAt(entry.deletedAt, now)}
      </div>
      {kids.length > 0 && (
        <div className="k">
          含 {kids.length} 个子项：{preview}
        </div>
      )}
      <div className="a">
        <button className="btn pri" title="恢复到原来的位置" onClick={() => restoreFromTrash(entry.id)}>
          恢复
        </button>
        <button className={`btn ${armed ? 'conf' : 'bad'}`} onClick={purge}>
          {armed ? '再点一次彻底删除' : '彻底删除'}
        </button>
      </div>
    </motion.div>
  );
}

/** 回收站：从 ⋯ 菜单或侧栏底部进入，显示在内容区 */
export function TrashView() {
  const trash = useData((s) => s.trash);
  const [now, setNow] = useState(() => Date.now());
  const [armedAll, emptyAll] = useConfirm(() => useData.getState().emptyTrash());
  const sorted = useMemo(() => [...trash].sort((a, b) => b.deletedAt - a.deletedAt), [trash]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === 'Escape' && !ui.menu && !ui.mainMenuOpen && !ui.profileMenuOpen) ui.set({ trashOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <div className="lh trash">
        <b>回收站</b>
        {trash.length > 0 && (
          <button className={`btn ${armedAll ? 'conf' : 'bad'}`} onClick={emptyAll}>
            {armedAll ? '再点一次清空' : '清空'}
          </button>
        )}
      </div>
      <p className="trash-cap">删除的条目连同子项保留 {TRASH_KEEP_DAYS} 天，可以恢复到原来的位置。</p>
      {sorted.length === 0 ? (
        <EmptyState view="history" small icon={TrashIcon} title="Nothing here." text="回收站是空的。删除的条目会在这里放 30 天。" />
      ) : (
        <div className="trash-list">
          <AnimatePresence initial={false}>
            {sorted.map((e) => (
              <TrashCard key={e.id} entry={e} now={now} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
