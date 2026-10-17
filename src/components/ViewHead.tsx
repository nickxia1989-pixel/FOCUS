import type { ReactNode } from 'react';
import { useData } from '../store';

/** 内容区顶部的标题：有多个 profile 时带上当前 profile 名 */
export function ViewHead({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  const profileName = useData((s) => (s.profiles.length > 1 ? s.profiles.find((p) => p.id === s.profileId)?.name : null));
  return (
    <header className="view-head">
      <div className="view-head-text">
        {profileName && (
          <>
            <span className="view-profile">{profileName}</span>
            <span className="view-slash">/</span>
          </>
        )}
        <span className="view-title">{title}</span>
        <span className="view-hint">{hint}</span>
      </div>
      {children}
    </header>
  );
}
