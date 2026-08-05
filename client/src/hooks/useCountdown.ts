import { useEffect, useState } from 'react';

/** 回合倒數，每 250ms 更新一次。deadline 為 0 表示沒有進行中的回合。 */
export function useCountdown(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now()); // 換回合時先對時，不然會沿用上次 tick 的舊時間閃一下錯誤秒數
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : 0;
}
