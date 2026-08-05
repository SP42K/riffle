import { useEffect, useMemo, useState } from 'react';
import {
  HOLDEM_STREET_LABEL,
  SEAT_LIMITS,
  TURN_MS,
  bestHand,
  describeHoldemHand,
  type HoldemGameView,
  type LegalActions,
  type RoomView,
} from 'shared';
import { PlayingCard } from '../components/PlayingCard';
import { StartControls } from '../components/StartControls';
import { useCountdown } from '../hooks/useCountdown';
import { emitWithAck } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { RoomShell } from './RoomShell';

const BOARD_SLOTS = 5;

export function HoldemRoom({ room }: { room: RoomView }) {
  const { run } = useGame();
  const game = room.game?.type === 'holdem' ? room.game : null;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const isMyTurn = playing && game?.turnPlayerId === me.playerId;

  const hole = useMemo(() => room.hand ?? [], [room.hand]);
  const actions = game?.myActions ?? null;
  const remainingMs = useCountdown(playing ? (game?.turnDeadline ?? 0) : 0);

  const mySeat = room.seats.find((seat) => seat.playerId === me.playerId);
  const myInfo = mySeat && game ? game.seats[mySeat.seat] : undefined;
  const myChips = room.chips?.[me.playerId] ?? 0;

  // 只有兩人以上搶的池才值得單獨列出來；一個人獨佔的那層是還沒被跟的注，之後會退回
  const contestedPots = game?.pots.filter((pot) => pot.eligible.length > 1) ?? [];

  const [raiseTo, setRaiseTo] = useState(0);
  // 換人講話或注額變了就把加注滑桿重設到最小值
  const raiseFloor = actions?.canRaise ? actions.minRaiseTo : 0;
  useEffect(() => setRaiseTo(raiseFloor), [raiseFloor, game?.turnPlayerId, game?.handNo]);

  const myHand = useMemo(
    () => (game ? bestHand([...hole, ...game.board]) : null),
    [hole, game],
  );

  const act = (action: 'fold' | 'check' | 'call' | 'raise' | 'allin', amount?: number) =>
    run(() => emitWithAck('game:action', amount === undefined ? { action } : { action, amount }));

  const center = (
    <>
      {!game && (
        <div className="table__idle">
          <p>等待房主開始牌局</p>
          <p className="muted">
            目前 {room.seats.length}/{room.maxPlayers} 人，至少 {SEAT_LIMITS.holdem.min} 人可開始
          </p>
        </div>
      )}

      {game && (
        <>
          <div className="holdem__meta">
            <span>第 {game.handNo} 手</span>
            <span className="holdem__street">{HOLDEM_STREET_LABEL[game.street]}</span>
            <span className="muted">
              盲注 {game.smallBlind}/{game.bigBlind}
            </span>
          </div>

          <div className="holdem__board">
            {Array.from({ length: BOARD_SLOTS }, (_, i) => {
              const card = game.board[i];
              return card ? (
                <PlayingCard key={card.id} card={card} />
              ) : (
                <span key={`slot-${i}`} className="holdem__slot" />
              );
            })}
          </div>

          <div className="holdem__pots">
            <span className="holdem__pot">底池 {game.totalPot}</span>
            {contestedPots.length > 1 &&
              contestedPots.map((pot, index) => (
                <span key={index} className="holdem__pot holdem__pot--side">
                  {index === 0 ? '主池' : `邊池 ${index}`} {pot.amount}
                </span>
              ))}
            {game.currentBet > 0 && <span className="muted">目前注額 {game.currentBet}</span>}
          </div>

          {!game.over && (
            <div className="table__turn">
              <span>
                輪到{' '}
                <strong>
                  {isMyTurn
                    ? '你'
                    : (room.seats.find((s) => s.playerId === game.turnPlayerId)?.nickname ?? '—')}
                </strong>
              </span>
              <div className="timer">
                <div
                  className="timer__bar"
                  style={{ width: `${Math.min(100, (remainingMs / TURN_MS) * 100)}%` }}
                />
              </div>
              <span className="timer__value">{Math.ceil(remainingMs / 1000)}s</span>
            </div>
          )}

          {game.over && game.showdown && <Showdown game={game} />}
        </>
      )}
    </>
  );

  const footer = (
    <>
      <div className="room__controls">
        {!game || game.over ? (
          <StartControls room={room} />
        ) : (
          <BetControls
            actions={actions}
            raiseTo={raiseTo}
            onRaiseTo={setRaiseTo}
            onAct={act}
            disabled={!isMyTurn}
          />
        )}
        <span className={`room__hint${isMyTurn ? ' room__hint--ok' : ''}`}>
          {buildHint({ game, playing, isMyTurn: Boolean(isMyTurn), actions })}
        </span>
      </div>

      <div className="holdem__mine">
        <div className="hand">
          {hole.map((card) => (
            <PlayingCard key={card.id} card={card} />
          ))}
          {hole.length === 0 && <p className="muted">{game ? '這一手沒有你的牌' : '等待發牌'}</p>}
        </div>
        <div className="holdem__me-info">
          <span className="seat__chips">🪙 {myChips}</span>
          {myInfo && myInfo.committed > 0 && (
            <span className="seat__bet">本街已下注 {myInfo.committed}</span>
          )}
          {myHand && <span className="holdem__strength">目前：{describeHoldemHand(myHand)}</span>}
        </div>
      </div>
    </>
  );

  return <RoomShell room={room} center={center} footer={isSpectator ? null : footer} />;
}

function Showdown({ game }: { game: HoldemGameView }) {
  return (
    <div className="table__result holdem__showdown">
      <h2>第 {game.handNo} 手結束</h2>
      <ul>
        {game.showdown?.map((entry) => (
          <li key={entry.playerId} className={entry.won > 0 ? 'holdem__winner' : undefined}>
            <span className="holdem__showdown-name">{entry.nickname}</span>
            {entry.hole && (
              <span className="holdem__showdown-cards">
                {entry.hole.map((card) => (
                  <PlayingCard key={card.id} card={card} small />
                ))}
              </span>
            )}
            {entry.hand && <span className="muted">{describeHoldemHand(entry.hand)}</span>}
            {entry.won > 0 && <span className="holdem__won">+{entry.won}</span>}
          </li>
        ))}
      </ul>
      <p className="muted">稍後自動發下一手</p>
    </div>
  );
}

interface BetControlsProps {
  actions: LegalActions | null;
  raiseTo: number;
  onRaiseTo: (value: number) => void;
  onAct: (action: 'fold' | 'check' | 'call' | 'raise' | 'allin', amount?: number) => void;
  disabled: boolean;
}

function BetControls({ actions, raiseTo, onRaiseTo, onAct, disabled }: BetControlsProps) {
  const canRaise = Boolean(actions?.canRaise) && !disabled;
  const min = actions?.minRaiseTo ?? 0;
  const max = actions?.maxRaiseTo ?? 0;

  return (
    <>
      <button
        type="button"
        className="btn btn--danger"
        disabled={disabled || !actions?.canFold}
        onClick={() => onAct('fold')}
      >
        蓋牌
      </button>
      <button
        type="button"
        className="btn"
        disabled={disabled || !actions?.canCheck}
        onClick={() => onAct('check')}
      >
        過牌
      </button>
      <button
        type="button"
        className="btn btn--primary"
        disabled={disabled || !actions?.canCall}
        onClick={() => onAct('call')}
      >
        跟注 {actions?.callAmount ?? 0}
      </button>

      <span className="holdem__raise">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Math.min(Math.max(raiseTo, min), max)}
          disabled={!canRaise}
          aria-label="加注金額"
          onChange={(event) => onRaiseTo(Number(event.target.value))}
        />
        <input
          type="number"
          className="holdem__raise-input"
          min={min}
          max={max}
          value={raiseTo}
          disabled={!canRaise}
          aria-label="加注到"
          onChange={(event) => onRaiseTo(Number(event.target.value))}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canRaise || raiseTo < min || raiseTo > max}
          onClick={() => onAct('raise', raiseTo)}
        >
          加注到 {raiseTo}
        </button>
      </span>

      <button
        type="button"
        className="btn"
        disabled={disabled || (!actions?.canRaise && !actions?.canCall)}
        onClick={() => onAct('allin')}
      >
        All-in
      </button>
    </>
  );
}

function buildHint(input: {
  game: HoldemGameView | null;
  playing: boolean;
  isMyTurn: boolean;
  actions: LegalActions | null;
}): string {
  const { game, playing, isMyTurn, actions } = input;
  if (!game) return '按下準備，等房主開局';
  if (game.over) return '這一手結束了，稍後自動發下一手';
  if (!playing) return '等待開局';
  if (!isMyTurn) return '等待其他玩家下注';
  if (!actions) return '你這一手沒有參與';
  if (actions.canCheck) return `可以過牌，或加注到 ${actions.minRaiseTo} 以上`;
  if (actions.canCall) return `要跟 ${actions.callAmount} 才能繼續`;
  return '輪到你了';
}
