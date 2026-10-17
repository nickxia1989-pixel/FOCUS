// 原生外壳的网页一侧（原生代码在 ios/App/App/FocusChrome.swift）。
// iOS 26 起页签栏、「+」、导航栏上的空间 / 同步 / ⋯ 由原生画（系统的 Liquid Glass），iPhone Duo 上系统把它们竖排到侧边。
// 这里把网页的状态推给原生，接原生的点按事件，并把"栏占掉的边距、折痕、铰链"写进 CSS 变量。
// 原生外壳不在时（浏览器、iOS 26 之前）nativeChrome 为 false，网页照旧自己画页签。
import { registerPlugin } from '@capacitor/core';
import { create } from 'zustand';
import { composeTarget, SECTION_META } from './components/Chrome';
import { PROFILE_TINTS, SECTIONS, type Section } from './data';
import { goSection, openComposer } from './actions';
import { statusOf } from './components/SyncSheets';
import { completedSince, openCount, startOfToday } from '../model';
import { LISTS } from '../types';
import { activeOf, useData } from './store';
import { useUi } from './ui';

/** 原生在页面脚本运行前打的标记（FocusChromePlugin.markNative） */
export const nativeChrome = typeof document !== 'undefined' && document.documentElement.dataset.chrome === 'native';

export interface Point {
  x: number;
  y: number;
}

export interface ChromeGeometry {
  /** 原生栏在系统安全区之外又占掉的边距（导航栏、页签栏） */
  insets: { top: number; right: number; bottom: number; left: number };
  /** 折痕（iPhone Duo 内屏），窗口坐标，等于网页的 CSS 像素；没有折痕的设备上是 null */
  fold: { x: number; y: number; width: number; height: number; active: boolean } | null;
  hinge: 'closed' | 'partial' | 'open' | null;
  /** 系统把栏竖排在哪一侧（Duo 合上的外屏、横着的内屏）；横排时是 null */
  bar: 'left' | 'right' | null;
  /** 原生页签图标的位置：「飞向某个分区」的终点 */
  targets: Partial<Record<Section, Point>>;
}

const EMPTY: ChromeGeometry = {
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  fold: null,
  hinge: null,
  bar: null,
  targets: {},
};

export const useChrome = create<{ geo: ChromeGeometry }>(() => ({ geo: EMPTY }));

interface ChromePlugin {
  setState(o: { json: string }): Promise<void>;
  getGeometry(): Promise<Partial<ChromeGeometry>>;
  addListener(event: 'geometry', fn: (g: Partial<ChromeGeometry>) => void): Promise<unknown>;
  addListener(event: 'tab', fn: (e: { section: Section }) => void): Promise<unknown>;
  addListener(event: 'action', fn: (e: { name: string }) => void): Promise<unknown>;
}

const Native = registerPlugin<ChromePlugin>('FocusChrome');

function applyGeometry(raw: Partial<ChromeGeometry>) {
  const geo: ChromeGeometry = { ...EMPTY, ...raw, insets: { ...EMPTY.insets, ...raw.insets } };
  const root = document.documentElement;
  for (const k of ['top', 'right', 'bottom', 'left'] as const)
    root.style.setProperty(`--chrome-${k}`, `${Math.round(geo.insets[k])}px`);
  if (geo.hinge) root.dataset.hinge = geo.hinge;
  else delete root.dataset.hinge;
  if (geo.bar) root.dataset.bar = geo.bar;
  else delete root.dataset.bar;
  useChrome.setState({ geo });
}

/** 推给原生的状态（字段对应 FocusChrome.swift 的 ChromeState） */
function snapshot() {
  const d = useData.getState();
  const ui = useUi.getState();
  const profile = activeOf(d);
  const counts = {} as Record<Section, number>;
  for (const l of LISTS) counts[l.id] = openCount(profile.todos, l.id);
  counts.history = completedSince(profile.todos, startOfToday(Date.now()));
  const css = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(SECTIONS.map((s) => [s, css.getPropertyValue(`--c-${s}`).trim()]));
  const st = statusOf(d.syncStatus, d.local.sync.enabled);
  const conflicts = d.conflicts.length;
  return {
    section: d.prefs.section,
    counts,
    colors,
    profile: { name: profile.name, color: PROFILE_TINTS[profile.tint] ?? PROFILE_TINTS[0] },
    sync: { tone: st.tone, conflicts, label: conflicts ? `有 ${conflicts} 个冲突需要决定` : st.text },
    menu: { trash: profile.trash.length, sound: d.prefs.sound, haptics: d.prefs.haptics },
    title: ui.scrolled ? SECTION_META[d.prefs.section].label : null,
    modal: !!(ui.sheet || ui.menu || ui.more || ui.composer.open),
    pulse: ui.pulse,
  };
}

function onAction(name: string) {
  const ui = useUi.getState();
  const d = useData.getState();
  switch (name) {
    case 'compose':
      openComposer(composeTarget(d.prefs.section));
      break;
    case 'profiles':
    case 'trash':
      ui.set({ sheet: name, menu: null, swipedId: null, editingId: null });
      break;
    case 'sync':
      ui.set({ sheet: d.conflicts.length ? 'conflicts' : 'sync', menu: null, swipedId: null, editingId: null });
      break;
    case 'sound':
      d.setPrefs({ sound: !d.prefs.sound });
      break;
    case 'haptics':
      d.setPrefs({ haptics: !d.prefs.haptics });
      break;
  }
}

let started = false;

/** 数据载入后调用：开始和原生外壳互通 */
export function initChrome() {
  if (!nativeChrome || started) return;
  started = true;
  void Native.getGeometry()
    .then(applyGeometry)
    .catch(() => {});
  void Native.addListener('geometry', applyGeometry);
  // 和当前分区一样就不动：goSection 会顺手结束正在编辑的条目
  void Native.addListener('tab', (e) => {
    if (e.section !== useData.getState().prefs.section) goSection(e.section);
  });
  void Native.addListener('action', (e) => onAction(e.name));

  let last = '';
  let queued = false;
  const push = () => {
    queued = false;
    if (!useData.getState().loaded || !useData.getState().profiles.length) return;
    const json = JSON.stringify(snapshot());
    if (json === last) return;
    last = json;
    void Native.setState({ json }).catch(() => {});
  };
  // 同一轮里的多次变动合并成一次
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(push);
  };
  useData.subscribe(schedule);
  useUi.subscribe(schedule);
  // 浅色 / 深色切换后主题色跟着变
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  schedule();
}
