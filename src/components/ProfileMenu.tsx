import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMac } from '../platform';
import { showToast, useData, useUi } from '../store';
import type { Profile } from '../types';
import { CheckIcon, EditIcon, PlusIcon, TrashIcon } from './icons';
import { isComposing } from './Inputs';
import { avatarStyle, initialOf } from './Nav';

export const PROFILE_SHORTCUT = isMac ? '⌘⇧P' : 'Ctrl+Shift+P';

function NameInput(props: { initial?: string; placeholder: string; onSubmit(name: string): void; onCancel(): void }) {
  const [text, setText] = useState(props.initial ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && text.trim()) props.onSubmit(text);
    else props.onCancel();
  };

  return (
    <input
      ref={ref}
      value={text}
      maxLength={24}
      placeholder={props.placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(e.key === 'Enter');
        }
      }}
      onBlur={() => finish(true)}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

/** profile 菜单（从页签行头像 / 侧栏空间卡片弹出）：切换、新建、改名、删除 */
function Menu() {
  const profiles = useData((s) => s.profiles);
  const activeId = useData((s) => s.profileId);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 10, y: 82 });
  /** 正在改名的 profile id；'__new' 表示正在新建 */
  const [editing, setEditing] = useState<string | null>(null);
  /** 删除需要再点一次确认 */
  const [armed, setArmed] = useState<string | null>(null);

  const close = () => useUi.getState().set({ profileMenuOpen: false });
  const pick = (id: string) => {
    close();
    void useData.getState().switchProfile(id);
  };
  const remove = async (p: Profile) => {
    setArmed(null);
    await useData.getState().deleteProfile(p.id);
    showToast(`已删除「${p.name}」`);
  };

  useLayoutEffect(() => {
    const a = document.querySelector<HTMLElement>('[data-profile-anchor]')?.getBoundingClientRect();
    const r = ref.current?.getBoundingClientRect();
    if (!a || !r) return;
    const pad = 6;
    let x = a.left - 2;
    let y = a.bottom + 8;
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - pad - r.width);
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - pad - r.height);
    setPos({ x, y });
  }, [profiles.length, editing]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.('[data-profile-anchor]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || editing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      // 数字键直接切换
      if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const p = profiles[Number(e.key) - 1];
        if (p) {
          e.preventDefault();
          pick(p.id);
        }
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [profiles, editing]);

  return (
    <motion.div
      ref={ref}
      className="pop"
      role="menu"
      style={{ left: pos.x, top: pos.y, width: 236 }}
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="mcap up">PROFILE</div>
      {profiles.map((p, i) => {
        const on = p.id === activeId;
        if (editing === p.id)
          return (
            <div key={p.id} className="pf on">
              <span className="a" style={avatarStyle(i)}>
                {initialOf(p.name)}
              </span>
              <NameInput
                initial={p.name}
                placeholder="名称"
                onSubmit={(name) => {
                  useData.getState().renameProfile(p.id, name);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          );
        return (
          <div
            key={p.id}
            className={`pf ${on ? 'on' : ''}`}
            role="menuitemradio"
            aria-checked={on}
            tabIndex={-1}
            onClick={(e) => {
              if ((e.target as Element).closest('.ed')) return;
              pick(p.id);
            }}
          >
            <span className="a" style={avatarStyle(i)}>
              {initialOf(p.name)}
            </span>
            <b>{p.name}</b>
            {on && <CheckIcon className="ck" />}
            <span className="ed">
              <button className="mini" title="重命名" onClick={() => setEditing(p.id)}>
                <EditIcon />
              </button>
              {profiles.length > 1 && (
                <button
                  className={`mini del ${armed === p.id ? 'armed' : ''}`}
                  title={armed === p.id ? '再点一次删除' : '删除'}
                  onClick={() => (armed === p.id ? void remove(p) : setArmed(p.id))}
                >
                  {armed === p.id ? '删除' : <TrashIcon />}
                </button>
              )}
            </span>
            {i < 9 && <em>{i + 1}</em>}
          </div>
        );
      })}
      <div className="msep" />
      {editing === '__new' ? (
        <div className="pf">
          <PlusIcon className="ck" />
          <NameInput
            placeholder="新 profile 的名字，如：工作"
            onSubmit={(name) => {
              close();
              void useData.getState().createProfile(name);
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <button className="mi" onClick={() => setEditing('__new')}>
          <PlusIcon />
          新建 profile
        </button>
      )}
      <div className="mcap">{PROFILE_SHORTCUT} 打开 · 数字键切换</div>
    </motion.div>
  );
}

export function ProfileMenu() {
  const open = useUi((s) => s.profileMenuOpen);
  return <AnimatePresence>{open && <Menu />}</AnimatePresence>;
}
