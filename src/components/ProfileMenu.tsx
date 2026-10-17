import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { isMac } from '../platform';
import { showToast, useData, useUi } from '../store';
import type { Profile } from '../types';
import { CheckIcon, EditIcon, PlusIcon, TrashIcon } from './icons';

const PALETTE = ['#f06a5d', '#e8973d', '#3aa76d', '#24a3b4', '#4c7cf0', '#6f5cf0', '#a25cf0', '#e0559b'];

export const PROFILE_SHORTCUT = isMac ? '⌘⇧P' : 'Ctrl+Shift+P';

/** 按 id 固定配色，改名不变色 */
export function profileColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 头像上的字：取名字的第一个字符，英文转大写 */
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

export function ProfileAvatar({ profile, size = 28 }: { profile: Profile; size?: number }) {
  const style = { '--pf-color': profileColor(profile.id), width: size, height: size, fontSize: Math.round(size * 0.46) };
  return (
    <span className="pf-avatar" style={style as CSSProperties} aria-hidden>
      {initialOf(profile.name)}
    </span>
  );
}

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

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
    <div className="pf-input-row">
      <input
        ref={ref}
        className="pf-input"
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
    </div>
  );
}

/** 侧栏顶部头像点开的 profile 菜单：切换、新建、改名、删除 */
export function ProfileMenu({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const profiles = useData((s) => s.profiles);
  const activeId = useData((s) => s.profileId);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -999, y: -999 });
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
    const a = anchor.current?.getBoundingClientRect();
    const r = ref.current?.getBoundingClientRect();
    if (!a || !r) return;
    const pad = 6;
    let x = a.left;
    let y = a.bottom + 6;
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - pad - r.width);
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - pad - r.height);
    setPos({ x, y });
  }, [anchor, profiles.length, editing]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
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
  }, [anchor, profiles, editing]);

  return (
    <div ref={ref} className="menu pf-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      <div className="menu-note">Profile</div>
      {profiles.map((p, i) =>
        editing === p.id ? (
          <NameInput
            key={p.id}
            initial={p.name}
            placeholder="名称"
            onSubmit={(name) => {
              useData.getState().renameProfile(p.id, name);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div key={p.id} className={`pf-item ${p.id === activeId ? 'is-active' : ''}`}>
            <button className="menu-item pf-pick" onClick={() => pick(p.id)}>
              <ProfileAvatar profile={p} size={20} />
              <span className="pf-name">{p.name}</span>
              {p.id === activeId ? (
                <CheckIcon className="pf-check" width={14} height={14} />
              ) : (
                i < 9 && <kbd className="pf-key">{i + 1}</kbd>
              )}
            </button>
            <span className="pf-tools">
              <button className="pf-tool" title="重命名" onClick={() => setEditing(p.id)}>
                <EditIcon width={13} height={13} />
              </button>
              {profiles.length > 1 && (
                <button
                  className={`pf-tool pf-delete ${armed === p.id ? 'is-armed' : ''}`}
                  title={armed === p.id ? '再点一次删除' : '删除'}
                  onClick={() => (armed === p.id ? void remove(p) : setArmed(p.id))}
                >
                  {armed === p.id ? '删除' : <TrashIcon width={13} height={13} />}
                </button>
              )}
            </span>
          </div>
        ),
      )}
      <div className="menu-sep" />
      {editing === '__new' ? (
        <NameInput
          placeholder="新 profile 的名字，如：工作"
          onSubmit={(name) => {
            close();
            void useData.getState().createProfile(name);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button className="menu-item" onClick={() => setEditing('__new')}>
          <span className="menu-check">
            <PlusIcon />
          </span>
          新建 profile
        </button>
      )}
      <div className="menu-note pf-hint">{PROFILE_SHORTCUT} 打开 · 数字键切换</div>
    </div>
  );
}
