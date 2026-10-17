import { useEffect, useState } from 'react';
import { startOfToday } from '../model';

/** 今天 0 点；过了午夜自动更新 */
export function useTodayStart() {
  const [today, setToday] = useState(() => startOfToday(Date.now()));
  useEffect(() => {
    const t = setInterval(() => setToday(startOfToday(Date.now())), 60_000);
    return () => clearInterval(t);
  }, []);
  return today;
}
