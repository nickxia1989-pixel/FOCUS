/** 列表条目共用的进出场 / 重排动画 */
export const nodeMotion = {
  layout: 'position' as const,
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 56, height: 0, transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const } },
  transition: {
    layout: { type: 'spring' as const, stiffness: 520, damping: 42 },
    opacity: { duration: 0.18 },
    y: { duration: 0.22 },
  },
};
