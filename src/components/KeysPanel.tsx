import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { isMac } from '../platform';
import { useUi } from '../store';
import { BackIcon } from './icons';

const M = isMac ? '⌘' : 'Ctrl+';
const ALT = isMac ? '⌥' : 'Alt+';
const SHIFT = isMac ? '⇧' : 'Shift+';

/** 快捷键与编辑规则（和 iOS 同一套编辑规则），从 ⋯ 菜单打开 */
const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: '编辑（双击文字进入）',
    keys: [
      ['↵', '保存，并在后面开一个同层级的空行接着写；空行有内容再回车才新建，空着回车就结束'],
      ['Tab', '缩进：挂到上一条下面，成为它的最后一个子项（空行也可以）'],
      [`${SHIFT}Tab`, '反缩进：升一级，排在原父项后面'],
      ['', '同级第一个按 Tab、顶层按 Shift+Tab 不动，编辑框抖一下'],
      [`${ALT}${SHIFT}↑ / ↓`, '在同级里上移 / 下移'],
      ['↑ / ↓', '光标在开头 / 结尾时，跳到上一条 / 下一条继续编辑'],
      ['⌫', '空行上：关掉空行，回到上一条'],
      ['Esc', '放弃这次修改 / 关掉空行'],
      ['', '拼音组字时这些键只上屏，不触发'],
    ],
  },
  {
    title: '新建',
    keys: [
      ['↵', '新建；FOCUS 里排在聚焦区后面，不打乱正在盯着的事'],
      [`${M}↵`, '在 FOCUS 新建并放进聚焦区'],
      [`${M}N`, '聚焦新建框'],
    ],
  },
  {
    title: '全局',
    keys: [
      [`${M}1–5`, '切换 FOCUS / VERIFY / INBOX / GOAL / HISTORY'],
      [`${M}${SHIFT}P`, '打开 profile 菜单，菜单里按数字键切换'],
      [`${M}Z`, '撤销刚才的删除'],
      ['⌫ / Delete', '右键菜单打开时：删除这一条'],
      ['Esc', '关闭菜单、面板、回收站；拖拽中取消拖拽'],
    ],
  },
];

function Sheet() {
  const close = () => useUi.getState().set({ keysOpen: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <motion.section
      className="sheet"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="shh">
        <button className="bk" title="返回（Esc）" aria-label="返回" onClick={close}>
          <BackIcon />
        </button>
        <b>快捷键与编辑</b>
      </header>
      <div className="shb">
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="keys-h">{sec.title}</div>
            <div className="card keys" style={{ marginTop: 6 }}>
              {sec.keys.map(([k, v], i) => (
                <div key={i} className="kr">
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

export function KeysPanel() {
  const open = useUi((s) => s.keysOpen);
  return <AnimatePresence>{open && <Sheet />}</AnimatePresence>;
}
