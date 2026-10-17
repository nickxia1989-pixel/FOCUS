// 空状态：叠放的空卡片插画 + 一句大字 + 说明 + 按钮（设计 P10）
import { goSection, openComposer } from '../actions';
import type { Section } from '../data';
import { InboxIcon, PlusIcon, SparkIcon } from '../icons';

const COPY: Record<Section, { big: string; text: string }> = {
  focus: { big: 'Nothing now.', text: 'FOCUS 空了。从 INBOX 挑一件当「现在」，或者就停在这儿，喝口水。' },
  verify: { big: 'All checked.', text: '做完但还要测的，会出现在这里。\n测完勾掉，它会回到 INBOX 的已完成。' },
  inbox: { big: 'Inbox zero.', text: '脑子清空了。想到什么，随手记下来。' },
  goal: { big: 'No goals yet.', text: '写下一个长期目标，给自己一个提醒。做到了自己勾掉。' },
  history: { big: 'Nothing yet.', text: '完成的事会按日期记在这里。去勾掉第一件吧。' },
};

export function Empty({ section, small }: { section: Section; small?: boolean }) {
  const c = COPY[section];
  return (
    <div className={`empty ${small ? 'small' : ''}`}>
      <div className="empty-art" aria-hidden>
        <div className="a1" />
        <div className="a2" />
        <div className="a3" />
        <SparkIcon />
      </div>
      <b>{c.big}</b>
      <p>{c.text}</p>
      <div className="empty-actions">
        {section === 'focus' && (
          <button className="btn lime" onClick={() => goSection('inbox')}>
            <InboxIcon />去 INBOX 挑一件
          </button>
        )}
        {section === 'history' ? (
          <button className="btn lime" onClick={() => goSection('focus')}>
            <SparkIcon />去 FOCUS
          </button>
        ) : (
          <button className="btn" onClick={() => openComposer(section)}>
            <PlusIcon />
            {section === 'goal' ? '写一个' : '写一件'}
          </button>
        )}
      </div>
    </div>
  );
}
