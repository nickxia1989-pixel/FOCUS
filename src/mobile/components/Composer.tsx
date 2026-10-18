// 新建：贴着键盘的玻璃输入卡（设计 P3）。回车添加后保持打开，可以连续输入；
// 列表芯片选放进哪个列表，FOCUS 顶层项有「排在现在之后」开关（关掉 = 新建并设为现在）
import { useCallback, useEffect, useRef, useState } from 'react';
import { LISTS, type ListId } from '../../types';
import { addTodo, closeComposer, registerComposerInput } from '../actions';
import { ArrowUpIcon, SectionIcons, SubtaskIcon } from '../icons';
import { haptic, onKeyboard } from '../native';
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

  // 收起时不丢没提交的字：留作草稿（transient 里也存一份），下次打开接着写
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const draft = ref.current?.value ?? '';
      saveTransient({ composer: draft.trim() ? { list, parentId, text: draft } : undefined });
    }
    wasOpen.current = open;
  }, [open, list, parentId]);

  // 软键盘收起（键盘上的收起键、下滑收起、点别处失焦）时卡片跟着关。
  // 只认「软键盘起来过、又落下去」：接硬件键盘时没有软键盘（高度一直是 0 或只有矮矮的快捷栏），不会因此关掉
  const softKb = useRef(false);
  useEffect(
    () =>
      onKeyboard((shown, height) => {
        if (!useUi.getState().composer.open) {
          softKb.current = false;
          return;
        }
        if (shown) {
          if (height > 120) softKb.current = true;
          return;
        }
        if (!softKb.current) return;
        softKb.current = false;
        // 旋转时系统可能先报收起再报弹出：稍等一下，键盘真的没回来再关
        setTimeout(() => {
          const kb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb')) || 0;
          if (useUi.getState().composer.open && kb < 120) closeComposer();
        }, 220);
      }),
    [],
  );

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);
  useEffect(fit, [text, fit]);
  useRefitOnWidth(ref, fit);

  const afterNow = useData((s) => s.prefs.insertAfterNow);

  const submit = () => {
    const title = (ref.current?.value ?? text).trim();
    if (!title) return;
    const id = addTodo(title, list, parent?.id ?? null, afterNow);
    if (!id) return;
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
      <div className="composer glass" style={{ '--c': `var(--c-${list})` } as React.CSSProperties}>
        {parent && (
          <div className="composer-context">
            <SubtaskIcon width={15} height={15} />
            <span>添加到「{parent.title}」</span>
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
            className="send"
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
          <div className="chips" role="radiogroup" aria-label="放进哪个列表">
            {LISTS.map((l) => {
              const Icon = SectionIcons[l.id];
              const on = l.id === list;
              return (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={on}
                  aria-label={l.label}
                  className={`chip ${on ? 'on' : ''}`}
                  style={{ '--c': l.id === 'focus' ? 'var(--text)' : `var(--c-${l.id})` } as React.CSSProperties}
                  onPointerDown={keepFocus}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    refocus();
                    setList(l.id);
                  }}
                >
                  <Icon />
                  {on && l.label}
                </button>
              );
            })}
            {list === 'focus' && (
              <button
                role="switch"
                aria-checked={afterNow}
                className={`chip chip-sw ${afterNow ? 'is-on' : ''}`}
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => {
                  refocus();
                  haptic.selection();
                  useData.getState().setPrefs({ insertAfterNow: !afterNow });
                }}
              >
                <i aria-hidden />
                排在现在之后
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 软键盘起来了没有（外接键盘、浏览器里没有软键盘时卡片浮在底部，四角都圆） */
export function useKeyboardUp() {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setUp(parseFloat(getComputedStyle(root).getPropertyValue('--kb')) > 80);
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['style'] });
    return () => mo.disconnect();
  }, []);
  return up;
}
