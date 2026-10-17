import { Component, type ReactNode } from 'react';

/**
 * 界面渲染出错时不要整块白屏：显示出错信息和「重新加载」。
 * 数据在磁盘上不受影响，同步也在后台照常进行，重新加载即可恢复。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[FOCUS] 界面出错', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center',
          font: '15px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 650 }}>界面出了点问题</div>
        <div style={{ opacity: 0.6, maxWidth: 360, overflowWrap: 'anywhere' }}>数据没有丢失。{error.message}</div>
        <button
          onClick={() => location.reload()}
          style={{ marginTop: 6, padding: '10px 20px', borderRadius: 12, border: 0, font: 'inherit', fontWeight: 650, color: '#fff', background: '#2f7bf5' }}
        >
          重新加载
        </button>
      </div>
    );
  }
}
