import { useEffect, useRef, useState } from 'react';
import type { LogEvent } from 'shared';
import type { TextKey } from '../skins/text';

/** 碰／吃／槓／自摸／胡／放槍，2 秒後自動消失。 */
const BANNER_MS = 2_000;

export type MahjongBannerKind = 'chi' | 'peng' | 'gang' | 'selfDraw' | 'win' | 'shoot';

/** 大字提示是滿版蓋在座位上的，字面一定要走 skin，不能寫死中文。 */
export const MAHJONG_BANNER_TEXT_KEY: Record<MahjongBannerKind, TextKey> = {
  chi: 'mahjong.bannerChi',
  peng: 'mahjong.bannerPeng',
  gang: 'mahjong.bannerGang',
  selfDraw: 'mahjong.bannerSelfDraw',
  win: 'mahjong.bannerWin',
  shoot: 'mahjong.bannerShoot',
};

export interface MahjongActionBanner {
  kind: MahjongBannerKind;
}

/**
 * 追蹤 room.log 裡新出現、跟這個暱稱有關的吃／碰／槓／胡事件，換成 2 秒的大字提示。
 * LogEvent 本身沒有時間戳記，「新出現」是靠比對 seq 算的 —— 每次 seq 變大，
 * 增加的那個數量就是新事件的筆數。
 *
 * 不能直接比較 log.length：room.log 會被伺服器裁到只剩 LOG_HISTORY（60）筆，
 * 裁剪後陣列長度會停在定值不再變化，單看長度會誤判成「再也沒有新事件」——
 * 這正是第二局開始吃碰槓胡大字提示會消失的原因（第一局 log 還沒裁到上限）。
 * seq 是只增不減的累計計數，裁剪不影響它，永遠能算出正確的新增筆數。
 *
 * seenSeq 的初始值刻意用掛載當下的 seq，不是寫死 0：按 F8 切換外觀會換掉 Chrome
 * 包裝元件，逼 React 把底下整棵樹（含這個 hook 所在的 Seat／MahjongTable）解除掛載
 * 再重新掛載一次。如果初始值寫死 0，重新掛載後這個 ref 會被重置成 0，接著就會把
 * 「掛載之前老早發生過」的整段歷史 log 當成剛剛發生，對著已經吃過／胡過的座位再彈一次
 * 大字。用掛載當下的 seq 當起點，就只認得「掛載之後才新增」的事件，不會被單純的
 * 重新掛載（切外觀、重新整理）誤觸發。
 */
export function useMahjongActionBanner(
  log: readonly LogEvent[],
  seq: number,
  nickname: string,
): MahjongActionBanner | null {
  const [banner, setBanner] = useState<MahjongActionBanner | null>(null);
  const seenSeq = useRef(seq);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    const previousSeq = seenSeq.current;
    seenSeq.current = seq;
    if (seq <= previousSeq) return;

    const freshCount = Math.min(seq - previousSeq, log.length);
    const freshEvents = log.slice(log.length - freshCount);
    for (const event of freshEvents) {
      let next: MahjongActionBanner | null = null;
      if (event.t === 'mahjongMeld' && event.player === nickname) {
        next = { kind: event.kind === 'chi' ? 'chi' : event.kind === 'peng' ? 'peng' : 'gang' };
      } else if (event.t === 'mahjongWin' && event.player === nickname) {
        next = { kind: event.winType === 'selfDraw' ? 'selfDraw' : 'win' };
      } else if (event.t === 'mahjongWin' && event.from === nickname) {
        next = { kind: 'shoot' };
      }
      if (next) {
        if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
        setBanner(next);
        clearTimer.current = window.setTimeout(() => setBanner(null), BANNER_MS);
      }
    }
  }, [log, seq, nickname]);

  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  return banner;
}
