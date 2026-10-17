// 新设计的完成动效（screens/Motion.jpg）：6 颗星芒迸出、一颗星芒沿弧线飞向页签并冒「+1」、圆钮外圈爆开。
// 减少动态效果时都不播。提示音沿用 ../effects 的 chime。
const SPARK = 'M12 2.8c.8 5 3.4 7.6 8.4 8.4-5 .8-7.6 3.4-8.4 8.4-.8-5-3.4-7.6-8.4-8.4 5-.8 7.6-3.4 8.4-8.4z';

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

function spark(x: number, y: number, size: number) {
  const el = document.createElement('div');
  el.className = 'fx-spark';
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${SPARK}"/></svg>`;
  Object.assign(el.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  getLayer().appendChild(el);
  return el;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 6 颗星芒（8–12px）向外 30–60px 飞出并转 80–90°，寿命 400ms */
export function sparkBurst(x: number, y: number, n = 6, dist: [number, number] = [30, 46]) {
  if (reduceMotion()) return;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + rand(-0.3, 0.3) - Math.PI / 2;
    const d = rand(dist[0], dist[1]);
    const size = rand(8, 12);
    const el = spark(x, y, size);
    el.animate(
      [
        { transform: 'translate(0,0) scale(.3) rotate(0deg)', opacity: 1 },
        { transform: `translate(${Math.cos(angle) * d}px, ${Math.sin(angle) * d}px) scale(1) rotate(85deg)`, opacity: 0 },
      ],
      { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' },
    ).finished.then(() => el.remove());
  }
}

/** 圆钮外圈爆开 */
export function ringBurst(x: number, y: number, size = 60) {
  if (reduceMotion()) return;
  const el = document.createElement('div');
  el.className = 'fx-ring';
  Object.assign(el.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  getLayer().appendChild(el);
  el.animate(
    [
      { transform: 'scale(.9)', opacity: 0.9 },
      { transform: 'scale(1.7)', opacity: 0 },
    ],
    { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' },
  ).finished.then(() => el.remove());
}

/** 一颗星芒沿二次贝塞尔弧线飞到目标（页签图标），落地后冒「+1」并回调 */
export function flyStar(from: { x: number; y: number }, to: { x: number; y: number }, onLand?: () => void, label = '+1') {
  if (reduceMotion()) {
    onLand?.();
    return;
  }
  const el = spark(from.x, from.y, 12);
  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - 80;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
    frames.push({ transform: `translate(${x - from.x}px, ${y - from.y}px) rotate(${t * 180}deg) scale(${1 - t * 0.3})` });
  }
  el.animate(frames, { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(() => {
    el.remove();
    onLand?.();
    if (!label) return;
    const p = document.createElement('div');
    p.className = 'fx-plus1';
    p.textContent = label;
    Object.assign(p.style, { left: `${to.x + 6}px`, top: `${to.y - 18}px` });
    getLayer().appendChild(p);
    p.animate(
      [
        { transform: 'translateY(4px)', opacity: 0 },
        { transform: 'translateY(-6px)', opacity: 1, offset: 0.3 },
        { transform: 'translateY(-14px)', opacity: 0 },
      ],
      { duration: 700, easing: 'ease-out' },
    ).finished.then(() => p.remove());
  });
}

/** 一行缩到 .3、染成目标颜色，沿弧线飞到目标（送去验证） */
export function flyGhost(el: Element, to: { x: number; y: number }, color: string, onLand?: () => void) {
  if (reduceMotion()) {
    onLand?.();
    return;
  }
  const r = el.getBoundingClientRect();
  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: '16px',
    background: color,
    opacity: '0.9',
    transformOrigin: '50% 50%',
  });
  getLayer().appendChild(ghost);
  const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - 60;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
    const s = 1 - t * 0.7;
    frames.push({
      transform: `translate(${x - from.x}px, ${y - from.y}px) scale(${Math.max(0.3, s) * (i === 0 ? 1 : 0.4 + 0.6 * (1 - t))})`,
      opacity: i === 10 ? 0 : 0.9,
    });
  }
  ghost.animate(frames, { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(() => {
    ghost.remove();
    onLand?.();
  });
}
