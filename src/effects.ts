// 完成时的视觉/声音反馈：粒子、光环、飞向页签的小球、提示音

let layer: HTMLDivElement | null = null;

function getLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function spawn(className: string, x: number, y: number, size: number, style: Partial<CSSStyleDeclaration> = {}) {
  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, {
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    ...style,
  });
  getLayer().appendChild(el);
  return el;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 勾选处炸开一圈彩色粒子 + 扩散光环 */
export function burst(x: number, y: number, accent: string) {
  if (reduceMotion()) return;
  const palette = [accent, accent, '#ffc94a', '#ffe08a', '#ffffff'];

  const ring = spawn('fx-ring', x, y, 26, { borderColor: accent });
  ring
    .animate(
      [
        { transform: 'scale(0.5)', opacity: 0.9 },
        { transform: 'scale(2.3)', opacity: 0 },
      ],
      { duration: 560, easing: 'cubic-bezier(.2,.7,.3,1)' },
    )
    .finished.then(() => ring.remove());

  const n = 14;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
    const dist = rand(20, 46);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const size = rand(3, 6.5);
    const star = i % 3 === 0;
    const p = spawn(star ? 'fx-spark fx-star' : 'fx-spark', x, y, star ? size + 3 : size, {
      background: palette[i % palette.length],
    });
    const rot = rand(-180, 180);
    p.animate(
      [
        { transform: 'translate(0,0) scale(0.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.75}px, ${dy * 0.75}px) scale(1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy + 10}px) scale(0) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: rand(620, 900), easing: 'cubic-bezier(.15,.75,.35,1)' },
    ).finished.then(() => p.remove());
  }
}

/** 从某处飞出一颗发光小球落到目标页签，落地后回调 */
export function flyTo(from: { x: number; y: number }, to: { x: number; y: number }, color: string, onLand?: () => void) {
  if (reduceMotion()) {
    onLand?.();
    return;
  }
  const dot = spawn('fx-fly', from.x, from.y, 10, { background: color, boxShadow: `0 0 12px 3px ${color}` });
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(-30, dy * 0.35);
  dot
    .animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.35 + lift}px) scale(1.25)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.9 },
      ],
      { duration: 620, easing: 'cubic-bezier(.45,0,.25,1)' },
    )
    .finished.then(() => {
      dot.remove();
      onLand?.();
    });
}

// ---------- 提示音：用 WebAudio 现合成，不依赖音频文件 ----------

let ctx: AudioContext | null = null;

function tone(ac: AudioContext, out: AudioNode, freq: number, start: number, dur: number, peak: number) {
  for (const [mult, vol] of [
    [1, 1],
    [2, 0.18],
  ] as const) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak * vol, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

export function chime() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    tone(ctx, master, 880, t, 0.45, 0.12);
    tone(ctx, master, 1318.5, t + 0.085, 0.7, 0.1);
  } catch {
    // 没有音频设备时静默
  }
}
