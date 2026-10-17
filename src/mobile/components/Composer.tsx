// 底部的新建卡片：贴着键盘，回车添加后保持打开，可以连续输入
import { useCallback, useEffect, useRef, useState } from 'react';
import { LISTS, type ListId } from '../../types';
import { closeComposer, registerComposerInput } from '../actions';
import { ArrowUpIcon, SectionIcons, SubtaskIcon } from '../icons';
import { haptic } from '../native';
import { useData, useTodos } from '../store';
import { restored, saveTransient } from '../transient';
import { pulse, useRefitOnWidth, useUi } from '../ui';

export function Composer() {
  const { open, list, parentId } = useUi((s) => s.composer);
  const todos = useTodos();
  const parent = parentId ? todos.find((t) => t.id === parentId) : undefined;
  const ref = useRef<HTMLTextAreaElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 页面重载前没发出去的字（见 transient.ts）
  const [text, setText] = useState(() => restored.composer?.text ?? '');

  useEffect(() => {
    registerComposerInput(ref.current);
    return () => registerComposerInput(null);
  }, []);

  // 收起时清空；首次挂载时不清，保留恢复出来的草稿
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      setText('');
      saveTransient({ composer: undefined });
    }
    wasOpen.current = open;
  }, [open]);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);
  useEffect(fit, [text, fit]);
  useRefitOnWidth(ref, fit);

  const submit = () => {
    const title = (ref.current?.value ?? text).trim();
    if (!title) return;
    const id = useData.getState().add(title, list, parent?.id ?? null);
    if (!id) return;
    haptic.light();
    setText('');
    saveTransient({ composer: undefined });
    // 加到了别的列表（不在当前页）时，让那个分区的图标弹一下
    if (!parent && useData.getState().prefs.section !== list) pulse(list);
  };

  const setList = (l: ListId) => {
    haptic.selection();
    useUi.getState().set({ composer: { open: true, list: l, parentId: null } });
  };

  const meta = LISTS.find((l) => l.id === list)!;
  // 按钮上按下时别让输入框失焦，否则卡片会先收起（iOS 上靠 mousedown 拦）
  const keepFocus = (e: React.SyntheticEvent) => e.preventDefault();
  // 万一还是失焦了：按钮点击里把焦点要回来
  const refocus = () => {
    clearTimeout(blurTimer.current);
    if (document.activeElement !== ref.current) ref.current?.focus({ preventScroll: true });
  };

  return (
    <div className={`composer-layer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="composer-scrim" onClick={closeComposer} />
      <div className="composer" style={{ '--c': `var(--c-${list})` } as React.CSSProperties}>
        {parent && (
          <div className="composer-context">
            <SubtaskIcon width={15} height={15} />
            <span>添加到「{parent.title}」下</span>
          </div>
        )}
        <div className="composer-row">
          <textarea
            ref={ref}
            value={text}
            rows={1}
            placeholder={parent ? '子任务…' : meta.placeholder}
            enterKeyHint="send"
            onChange={(e) => {
              setText(e.target.value);
              saveTransient({ composer: { list, parentId, text: e.target.value } });
            }}
            onFocus={() => {
              clearTimeout(blurTimer.current);
              if (!useUi.getState().composer.open)
                useUi.getState().set({ composer: { ...useUi.getState().composer, open: true } });
            }}
            onBlur={() => {
              // 稍等一下再收起：焦点被卡片里的按钮要回来时不收
              clearTimeout(blurTimer.current);
              blurTimer.current = setTimeout(() => {
                if (document.activeElement === ref.current) return;
                const ui = useUi.getState();
                if (ui.composer.open) ui.set({ composer: { ...ui.composer, open: false, parentId: null } });
              }, 160);
            }}
            onKeyDown={(e) => {
              // 拼音等输入法组字时的回车只是上屏（Safari 里 isComposing 可能为 false，但 keyCode 是 229）
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') closeComposer();
            }}
          />
          <button
            className="composer-send"
            aria-label="添加"
            disabled={!text.trim()}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => {
              refocus();
              submit();
            }}
          >
            <ArrowUpIcon width={20} height={20} />
          </button>
        </div>
        {!parent && (
          <div className="composer-lists" role="radiogroup" aria-label="放进哪个列表">
            {LISTS.map((l) => {
              const Icon = SectionIcons[l.id];
              return (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={l.id === list}
                  className={`chip ${l.id === list ? 'is-on' : ''}`}
                  style={{ '--c': `var(--c-${l.id})` } as React.CSSProperties}
                  onPointerDown={keepFocus}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    refocus();
                    setList(l.id);
                  }}
                >
                  <Icon width={15} height={15} />
                  {l.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
