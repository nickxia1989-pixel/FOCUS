// 可左右滑动、可长按的行容器：右滑露出主操作，左滑露出一组按钮，滑过一大半直接执行。
// 纵向滚动交给浏览器（touch-action: pan-y），横向手势和长按自己处理。
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { haptic } from '../native';
import { useUi } from '../ui';

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  /** CSS 颜色 */
  color: string;
  run(el: Element | null): void;
}

interface Props {
  id: string;
  /** 右滑：单个主操作（例如完成） */
  leading?: SwipeAction | null;
  /** 左滑：从左到右排列，最后一个是滑到底时执行的操作（例如删除） */
  trailing?: SwipeAction[];
  onLongPress?(el: HTMLElement): void;
  disabled?: boolean;
  children: ReactNode;
}

const ACTION_W = 74;
const LONG_PRESS_MS = 460;
const SLOP = 9;

interface Gesture {
  pointerId: number;
  x0: number;
  y0: number;
  base: number;
  mode: 'pending' | 'swipe' | 'scroll' | 'press';
  timer: ReturnType<typeof setTimeout>;
}

export function SwipeRow({ id, leading = null, trailing = [], onLongPress, disabled, children }: Props) {
  const x = useMotionValue(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const open = useUi((s) => s.swipedId === id);
  const leadWidth = useTransform(x, (v) => Math.max(0, v));
  const trailWidth = useTransform(x, (v) => Math.max(0, -v));
  const fullRef = useRef<'lead' | 'trail' | null>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);

  // 别的行被滑开、或点了别处：收回
  useEffect(() => {
    if (!open && x.get() !== 0) animate(x, 0, { type: 'spring', stiffness: 520, damping: 44 });
  }, [open, x]);

  const width = () => wrapRef.current?.offsetWidth ?? 360;

  const setFull = (f: 'lead' | 'trail' | null) => {
    if (fullRef.current === f) return;
    fullRef.current = f;
    leadRef.current?.classList.toggle('is-full', f === 'lead');
    trailRef.current?.classList.toggle('is-full', f === 'trail');
    if (f) haptic.medium();
  };

  const settle = (to: number) => animate(x, to, { type: 'spring', stiffness: 480, damping: 42 });

  const end = (cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.mode === 'press') {
      suppressClick.current = true;
      return;
    }
    if (g.mode !== 'swipe') return;
    suppressClick.current = true;
    const w = width();
    const v = x.get();
    const vel = x.getVelocity();
    const full = fullRef.current;
    setFull(null);
    if (!cancelled && full === 'lead' && leading) {
      settle(0);
      useUi.getState().set({ swipedId: null });
      leading.run(wrapRef.current);
      return;
    }
    if (!cancelled && full === 'trail' && trailing.length) {
      animate(x, -w, { duration: 0.2, ease: [0.4, 0, 1, 1] });
      useUi.getState().set({ swipedId: null });
      trailing[trailing.length - 1].run(wrapRef.current);
      return;
    }
    const openLead = leading && (v > 56 || (v > 16 && vel > 500));
    const openTrail = trailing.length > 0 && (v < -56 || (v < -16 && vel < -500));
    if (!cancelled && openLead) {
      settle(ACTION_W + 8);
      useUi.getState().set({ swipedId: id });
    } else if (!cancelled && openTrail) {
      settle(-ACTION_W * trailing.length);
      useUi.getState().set({ swipedId: id });
    } else {
      settle(0);
      if (useUi.getState().swipedId === id) useUi.getState().set({ swipedId: null });
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    suppressClick.current = false;
    if (disabled || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('textarea, input, .swipe-actions')) return;
    const timer = setTimeout(() => {
      const g = gesture.current;
      if (!g || g.mode !== 'pending' || !onLongPress) return;
      g.mode = 'press';
      haptic.medium();
      settle(0);
      onLongPress(wrapRef.current!);
    }, LONG_PRESS_MS);
    gesture.current = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, base: x.get(), mode: 'pending', timer };
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.mode === 'pending') {
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 1.2 && (leading || trailing.length)) {
        g.mode = 'swipe';
        clearTimeout(g.timer);
        wrapRef.current?.setPointerCapture(e.pointerId);
        // 同时只开一行
        const ui = useUi.getState();
        if (ui.swipedId && ui.swipedId !== id) ui.set({ swipedId: null });
      } else if (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP) {
        g.mode = 'scroll';
        clearTimeout(g.timer);
        return;
      } else return;
    }
    if (g.mode !== 'swipe') return;
    const w = width();
    const maxLead = leading ? w : 0;
    const maxTrail = trailing.length ? w : 0;
    let nx = g.base + dx;
    // 超出可滑范围时加阻尼
    if (nx > maxLead) nx = maxLead + (nx - maxLead) * 0.2;
    if (nx < -maxTrail) nx = -maxTrail + (nx + maxTrail) * 0.2;
    if (!leading && nx > 0) nx *= 0.2;
    if (!trailing.length && nx < 0) nx *= 0.2;
    x.set(nx);
    const threshold = Math.min(w * 0.55, 260);
    setFull(leading && nx > threshold ? 'lead' : trailing.length && nx < -threshold ? 'trail' : null);
  };

  const onClickCapture = (e: MouseEvent) => {
    // 滑动、长按之后松手的那次 click 不算点击；行滑开时点内容区只负责收回
    if ((e.target as HTMLElement).closest('.swipe-actions')) return;
    if (suppressClick.current || open) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick.current = false;
      if (open) useUi.getState().set({ swipedId: null });
    }
  };

  return (
    <div
      ref={wrapRef}
      className="swipe"
      data-swipe-id={id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => end(false)}
      onPointerCancel={() => end(true)}
      onClickCapture={onClickCapture}
    >
      {leading && (
        <motion.div ref={leadRef} className="swipe-actions swipe-lead" style={{ width: leadWidth }}>
          <button
            style={{ background: leading.color }}
            onClick={(e) => {
              useUi.getState().set({ swipedId: null });
              leading.run(e.currentTarget);
            }}
          >
            {leading.icon}
            <span>{leading.label}</span>
          </button>
        </motion.div>
      )}
      {trailing.length > 0 && (
        <motion.div ref={trailRef} className="swipe-actions swipe-trail" style={{ width: trailWidth }}>
          {trailing.map((a) => (
            <button
              key={a.key}
              style={{ background: a.color }}
              onClick={(e) => {
                useUi.getState().set({ swipedId: null });
                a.run(e.currentTarget);
              }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </motion.div>
      )}
      <motion.div className="swipe-content" style={{ x }}>
        {children}
      </motion.div>
    </div>
  );
}
