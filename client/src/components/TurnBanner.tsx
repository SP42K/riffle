import { TURN_MS } from 'shared';
import { useSkin } from '../state/skinContext';

interface Props {
  isMyTurn: boolean;
  /** 目前該出手的人的暱稱；找不到就給 '—'。輪到自己時用不到。 */
  nickname: string;
  remainingMs: number;
}

/** 倒數只看當下剩多少，不記起始值 —— 對手離線時伺服器會把 deadline 縮到 3 秒，本來就會跳。 */
function urgencyOf(remainingMs: number): 'warn' | 'critical' | undefined {
  if (remainingMs <= 5_000) return 'critical';
  if (remainingMs <= 10_000) return 'warn';
  return undefined;
}

/**
 * 牌桌中央的回合列。大老二與德州撲克共用。
 * 輪到自己時整列會放大變色，配合 .room[data-myturn] 的整桌高亮。
 */
export function TurnBanner({ isMyTurn, nickname, remainingMs }: Props) {
  const { t } = useSkin();

  return (
    <div className="table__turn" data-mine={isMyTurn ? 'true' : undefined}>
      <span>
        {isMyTurn ? (
          t('room.turnMine')
        ) : (
          <>
            {t('room.turnPrefix')} <strong>{nickname}</strong>
          </>
        )}
      </span>
      <div className="timer" data-urgency={urgencyOf(remainingMs)}>
        <div
          className="timer__bar"
          style={{ width: `${Math.min(100, (remainingMs / TURN_MS) * 100)}%` }}
        />
      </div>
      <span className="timer__value">{Math.ceil(remainingMs / 1000)}s</span>
    </div>
  );
}
