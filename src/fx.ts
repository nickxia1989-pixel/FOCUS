// 桌面动效（设计 F「一件事」，时序见 design_handoff_focus/tokens.json → motion）：
// 星芒迸出、沿弧线飞向页签、页签弹一下冒 +1、行 / NOW 卡的克隆飞走、NOW 卡从队列行变形出来。
// iOS 版仍用 src/effects.ts。

export const EASE = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_EXIT = 'cubic-bezier(.4,0,1,1)';
export const EASE_SPRING = 'cubic-bezier(.3,1.25,.4,1)';

export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let layer: HTMLDivElement | null = null;

function getLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

export interface Pt {
  x: number;
  y: number;
}

export function centerOf(el: Element | null | undefined): Pt | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** 浅色底上用 #B8E600，深色底上直接荧光绿 */
export const sparkColor = () => cssVar('--spark') || '#B8E600';

/** 6 颗星芒向外迸出：8–12px，飞出 30–46px 并转 80°，寿命 400ms */
export function sparks(
  at: Pt,
  opts: { color?: string; count?: number; size?: [number, number]; dist?: [number, number]; rotate?: number; life?: number; delay?: number } = {},
) {
  if (reduceMotion()) return;
  const { count = 6, size = [8, 12], dist = [30, 46], rotate = 80, life = 400, delay = 0 } = opts;
  const color = opts.color ?? sparkColor();
  const offset = rand(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const s = rand(size[0], size[1]);
    const angle = offset + (i / count) * Math.PI * 2 + rand(-0.2, 0.2);
    const d = rand(dist[0], dist[1]);
    const el = document.createElement('div');
    el.className = 'fx-spark';
    Object.assign(el.style, {
      left: `${at.x - s / 2}px`,
      top: `${at.y - s / 2}px`,
      width: `${s}px`,
      height: `${s}px`,
      background: color,
      opacity: '0',
    });
    getLayer().appendChild(el);
    const dx = Math.cos(angle) * d;
    const dy = Math.sin(angle) * d;
    const rot = rotate * (Math.random() < 0.5 ? -1 : 1);
    el.animate(
      [
        { transform: 'translate(0,0) scale(.3) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) scale(1) rotate(${rot * 0.6}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(.4) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: life, delay, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'both' },
    ).finished.then(() => el.remove(), () => el.remove());
  }
}

/** NOW 完成钮外圈爆开 */
export function ringBurst(at: Pt, size: number, delay = 0) {
  if (reduceMotion()) return;
  const el = document.createElement('div');
  el.className = 'fx-ring';
  Object.assign(el.style, { left: `${at.x - size / 2}px`, top: `${at.y - size / 2}px`, width: `${size}px`, height: `${size}px`, opacity: '0' });
  getLayer().appendChild(el);
  el.animate(
    [
      { transform: 'scale(.9)', opacity: 0.9 },
      { transform: 'scale(1.9)', opacity: 0 },
    ],
    { duration: 360, delay, easing: EASE, fill: 'both' },
  ).finished.then(() => el.remove(), () => el.remove());
}

/** 二次贝塞尔弧线上的关键帧 */
function arcFrames(from: Pt, to: Pt, steps: number, f: (t: number, p: Pt) => Keyframe) {
  const lift = Math.min(-36, (to.y - from.y) * 0.4 - 40);
  const c = { x: from.x + (to.x - from.x) * 0.35, y: Math.min(from.y, to.y) + lift };
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const p = {
      x: u * u * from.x + 2 * u * t * c.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * c.y + t * t * to.y,
    };
    frames.push({ ...f(t, p), offset: t });
  }
  return frames;
}

/** 一颗星芒沿弧线飞向目标（完成 → HISTORY） */
export function flySpark(from: Pt, to: Pt, opts: { duration?: number; delay?: number; color?: string; onLand?: () => void } = {}) {
  const { duration = 300, delay = 0, onLand } = opts;
  if (reduceMotion()) {
    onLand && setTimeout(onLand, delay);
    return;
  }
  const s = 12;
  const el = document.createElement('div');
  el.className = 'fx-spark';
  Object.assign(el.style, { left: `${-s / 2}px`, top: `${-s / 2}px`, width: `${s}px`, height: `${s}px`, background: opts.color ?? sparkColor(), opacity: '0' });
  getLayer().appendChild(el);
  el.animate(
    arcFrames(from, to, 16, (t, p) => ({
      transform: `translate(${p.x}px, ${p.y}px) rotate(${t * 220}deg) scale(${1.15 - t * 0.35})`,
      opacity: t > 0.92 ? 0.6 : 1,
    })),
    { duration, delay, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' },
  ).finished.then(
    () => {
      el.remove();
      onLand?.();
    },
    () => el.remove(),
  );
}

/** 把元素复制一份放到动效层，原位不动；返回克隆和它的位置 */
export function cloneToLayer(src: HTMLElement): { el: HTMLElement; rect: DOMRect } {
  const rect = src.getBoundingClientRect();
  const el = src.cloneNode(true) as HTMLElement;
  el.classList.add('fx-clone');
  el.removeAttribute('data-node-id');
  el.removeAttribute('data-now-id');
  el.removeAttribute('data-drop-now');
  Object.assign(el.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: 'none',
    opacity: '1',
  });
  getLayer().appendChild(el);
  return { el, rect };
}

/** 克隆缩小后沿弧线飞向页签（送去验证、送进 FOCUS、移到别的列表） */
export function flyClone(src: HTMLElement, to: Pt, opts: { duration?: number; scale?: number; tint?: string; onLand?: () => void } = {}) {
  const { duration = 320, scale = 0.3, onLand } = opts;
  if (reduceMotion()) {
    onLand?.();
    return;
  }
  const { el, rect } = cloneToLayer(src);
  if (opts.tint) el.style.background = opts.tint;
  const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  el.style.left = `${-rect.width / 2}px`;
  el.style.top = `${-rect.height / 2}px`;
  el.style.transformOrigin = '50% 50%';
  el.animate(
    arcFrames(from, to, 16, (t, p) => ({
      transform: `translate(${p.x}px, ${p.y}px) scale(${1 - (1 - scale) * Math.min(1, t * 1.6)})`,
      opacity: t < 0.75 ? 1 : 1 - (t - 0.75) * 3,
      borderRadius: '14px',
    })),
    { duration, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' },
  ).finished.then(
    () => {
      el.remove();
      onLand?.();
    },
    () => el.remove(),
  );
}

/**
 * NOW 卡离场：
 * - up（完成、删除）：-30px、转 -3°、缩到 .95、淡出（ease-in 180ms）
 * - down（设为现在时被换下来）：往下沉、缩小、淡出，落进队列
 */
export function cardOut(src: HTMLElement, dir: 'up' | 'down' = 'up') {
  if (reduceMotion()) return;
  const { el } = cloneToLayer(src);
  el.animate(
    dir === 'up'
      ? [
          { transform: 'none', opacity: 1 },
          { transform: 'translateY(-30px) rotate(-3deg) scale(.95)', opacity: 0 },
        ]
      : [
          { transform: 'none', opacity: 1, transformOrigin: '50% 100%' },
          { transform: 'translateY(40px) scale(.92)', opacity: 0, transformOrigin: '50% 100%' },
        ],
    { duration: dir === 'up' ? 180 : 300, easing: dir === 'up' ? EASE_EXIT : EASE, fill: 'both' },
  ).finished.then(() => el.remove(), () => el.remove());
}

/** 页签 / 侧栏图标放大 1.18 弹一下；plus 时冒一个 +1 */
export function bump(el: Element | null, plus = false) {
  if (!el || reduceMotion()) return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(.96)' }, { transform: 'scale(1)' }],
    { duration: 420, easing: EASE_SPRING },
  );
  if (!plus) return;
  const c = centerOf(el);
  if (!c) return;
  const tag = document.createElement('div');
  tag.className = 'fx-plus';
  tag.textContent = '+1';
  Object.assign(tag.style, { left: `${c.x + 4}px`, top: `${c.y - 22}px` });
  getLayer().appendChild(tag);
  tag
    .animate(
      [
        { transform: 'translateY(6px) scale(.6)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.3 },
        { transform: 'translateY(-10px) scale(1)', opacity: 0 },
      ],
      { duration: 700, easing: EASE },
    )
    .finished.then(() => tag.remove(), () => tag.remove());
}

/** 眨一下眼：scaleY 1 → .1 → 1，160ms */
export function blink(el: Element | null | undefined) {
  const svg = el?.querySelector('svg') ?? el;
  if (!svg || reduceMotion()) return;
  svg.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)' }, { transform: 'scaleY(1)' }], { duration: 160, easing: 'ease-in-out' });
}

// ---------- 行离场方式 ----------

/**
 * 行被移走时怎么离场（列表的 AnimatePresence 把它当 custom 传给离场的行）：
 * - instant：这一行变成了 NOW 卡，原地直接消失
 * - collapse：克隆已经飞走了，原行立刻透明、高度收起
 */
export type ExitMode = 'instant' | 'collapse';
export const exitModes = new Map<string, ExitMode>();

export function setExitMode(id: string, mode: ExitMode) {
  exitModes.set(id, mode);
  setTimeout(() => exitModes.delete(id), 1200);
}

// ---------- NOW 卡交接：队列第 02 行变形成新的 NOW 卡 ----------

interface Handoff {
  /** 从哪一行变形过来；没有就是原地弹出（⌘↵ 新建并设为现在） */
  rect: DOMRect | null;
  /** 起始字号（队列行 13.5） */
  fontSize: number;
  delay: number;
}

const handoffs = new Map<string, Handoff>();

/** 动作这边：数据提交前记下那一行（或拖拽预览）的位置 */
export function prepareHandoff(id: string, from: Element | DOMRect | null | undefined, delay = 0) {
  if (!from) return;
  const rect = from instanceof DOMRect ? from : from.getBoundingClientRect();
  handoffs.set(id, { rect, fontSize: 13.5, delay });
  // 没有被消费（比如那张卡没渲染出来）就丢掉
  setTimeout(() => handoffs.delete(id), 1000);
}

/** 新卡原地弹出（新建并设为现在） */
export function preparePop(id: string) {
  handoffs.set(id, { rect: null, fontSize: 13.5, delay: 0 });
  setTimeout(() => handoffs.delete(id), 1000);
}

/** NOW 卡这边：新卡挂载时如果有交接记录，从那一行的位置、高度、底色、字号同时过渡过来 */
export function runHandoff(id: string, card: HTMLElement | null) {
  const h = handoffs.get(id);
  handoffs.delete(id);
  if (!card || !h) return;
  if (reduceMotion()) {
    card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    return;
  }
  if (!h.rect) {
    card.animate(
      [
        { transform: 'translateY(-8px) scale(.97)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 300, easing: EASE_SPRING },
    );
    return;
  }
  const r = card.getBoundingClientRect();
  const dx = h.rect.left - r.left;
  const dy = h.rect.top - r.top;
  const clipR = Math.max(0, r.width - h.rect.width);
  const clipB = Math.max(0, r.height - h.rect.height);
  const bg = cssVar('--sf') || '#fff';
  const opts = { duration: 360, delay: h.delay, easing: EASE_SPRING, fill: 'both' as FillMode };
  card.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, clipPath: `inset(0 ${clipR}px ${clipB}px 0 round 12px)`, backgroundColor: bg },
      { transform: 'translate(0,0)', clipPath: 'inset(0 0 0 0 round 22px)', backgroundColor: cssVar('--lime') || '#D6FF3D' },
    ],
    opts,
  );
  const title = card.querySelector<HTMLElement>('.now-title');
  if (title) {
    const size = parseFloat(getComputedStyle(title).fontSize) || 20;
    title.animate([{ fontSize: `${h.fontSize}px` }, { fontSize: `${size}px` }], opts);
  }
  for (const part of card.querySelectorAll<HTMLElement>('.now-top, .now-prog, .now-subs, .now-more, .now-act')) {
    part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: h.delay + 180, easing: EASE, fill: 'both' });
  }
}
