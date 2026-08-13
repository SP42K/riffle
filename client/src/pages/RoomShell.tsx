import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BIG_TWO_RULE_KEYS,
  MONOPOLY_OPTION_KEYS,
  MONOPOLY_OPTION_SPEC,
  bigTwoPresetOf,
  sortCards,
  type MonopolyOptionKey,
  type RoomView,
} from 'shared';
import { ChatPanel } from '../components/ChatPanel';
import { PlayingCard } from '../components/PlayingCard';
import { Seat } from '../components/Seat';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';

interface Props {
  room: RoomView;
  /** 牌桌中央，由各玩法自己畫。 */
  center: ReactNode;
  /** 底部控制列，觀戰者不會看到。 */
  footer: ReactNode;
  /** 輪到自己時整個房間會高亮，各玩法算好了傳進來。 */
  isMyTurn?: boolean;
  /** 底部的文字戰報。預設顯示；台灣麻將自己有大字提示跟棄牌堆可以看，關掉不重複。 */
  showLog?: boolean;
}

/**
 * 房間的外殼：標題列、座位、戰報、側欄聊天。
 * 這些跟玩法無關，大老二與德州撲克共用。
 */
export function RoomShell({ room, center, footer, isMyTurn, showLog = true }: Props) {
  const { roomMessages, run } = useGame();
  const { skin, t, prefs } = useSkin();
  const game = room.game;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const allHands = room.allHands;

  // 側欄在窄螢幕會夾在牌桌與控制列中間、把手牌擠到看不見，所以窄螢幕預設收起來。
  // 桌機不受影響：開關本身 display:none，收合的 CSS 也只寫在 860px 以下。
  const [chatOpen, setChatOpen] = useState(false);
  // 未讀 = 目前訊息數 - 上次打開時的訊息數。聊天訊息只增不減，長度差就夠用了。
  const [seenCount, setSeenCount] = useState(roomMessages.length);
  useEffect(() => {
    if (chatOpen) setSeenCount(roomMessages.length);
  }, [chatOpen, roomMessages.length]);
  const unread = Math.max(0, roomMessages.length - seenCount);

  // 輪到自己時震一下：手機螢幕關著或在看別的 App 時，這是唯一叫得動人的提示。
  // 只認 false→true 那一次，同一個回合裡重畫幾次都不會再震；
  // 初值直接抓進場當下的狀態，重新連線接回牌桌時不會莫名震一下。
  const wasMyTurn = useRef(Boolean(isMyTurn));
  useEffect(() => {
    const mine = Boolean(isMyTurn);
    const changed = mine && !wasMyTurn.current;
    wasMyTurn.current = mine;
    if (!changed) return;
    if (!prefs.vibrateOnTurn) return;
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    navigator.vibrate(200);
  }, [isMyTurn, prefs.vibrateOnTurn]);

  const others = room.seats.filter((seat) => seat.playerId !== me.playerId);
  const rules = room.bigTwoRules;
  // 套組講得清楚就只掛套組名；自訂的話把開著的規則逐條列出來
  const rulePreset = rules && bigTwoPresetOf(rules);
  const ruleDetails =
    rules && rulePreset === 'custom' ? BIG_TWO_RULE_KEYS.filter((key) => rules[key]) : [];

  // 大富翁沒有套組，只列跟預設不一樣的選項 —— 全開全關都掛上去的話標題列會爆掉
  const options = room.monopolyOptions;
  const optionTags: { key: MonopolyOptionKey; text: string }[] = options
    ? MONOPOLY_OPTION_KEYS.flatMap((key) => {
        const spec = MONOPOLY_OPTION_SPEC[key];
        const value = options[key];
        if (value === spec.default) return [];
        const text =
          spec.kind === 'flag'
            ? skin.monopolyOption[key]
            : `${skin.monopolyOption[key]} ${value}`;
        return [{ key, text }];
      })
    : [];

  return (
    <div className="room" data-myturn={isMyTurn ? 'true' : undefined}>
      <header className="room__header">
        <div>
          <h1>{room.name}</h1>
          <span className="room__code">{t('room.code', { id: room.id })}</span>
          <span className="tag tag--game">{skin.gameType[room.gameType]}</span>
          {rulePreset && <span className="tag tag--rules">{skin.bigTwoPreset[rulePreset]}</span>}
          {ruleDetails.map((key) => (
            <span key={key} className="tag tag--rules">
              {skin.bigTwoRule[key]}
            </span>
          ))}
          {optionTags.map((tag) => (
            <span key={tag.key} className="tag tag--rules">
              {tag.text}
            </span>
          ))}
          {isSpectator && <span className="tag tag--spectator">{t('room.spectating')}</span>}
        </div>
        <div className="room__header-actions">
          {isSpectator && room.seats.length < room.maxPlayers && !playing && (
            <button
              type="button"
              className="btn"
              onClick={() => run(() => emitWithAck('room:join', { roomId: room.id, mode: 'play' }))}
            >
              {t('room.sitDown')}
            </button>
          )}
          {!isSpectator && !playing && (
            <button
              type="button"
              className="btn"
              onClick={() => run(() => emitWithAck('room:join', { roomId: room.id, mode: 'spectate' }))}
            >
              {t('room.toSpectator')}
            </button>
          )}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => run(() => emitWithAck('room:leave', {}))}
          >
            {t('room.leave')}
          </button>
        </div>
      </header>

      <div className="room__body">
        <div className="table">
          <div className="table__seats">
            {others.map((seat) => (
              <Seat
                key={seat.playerId}
                seat={seat}
                isTurn={game?.turnPlayerId === seat.playerId}
                isMe={false}
                playing={playing}
                gameType={room.gameType}
                game={game}
                chips={room.chips?.[seat.playerId]}
                snakeUnlimitedLives={room.snakeOptions?.unlimitedLives ?? false}
                log={room.log}
                logSeq={room.logSeq}
              />
            ))}
            {Array.from({ length: room.maxPlayers - room.seats.length }, (_, i) => (
              <div key={`empty-${i}`} className="seat seat--empty">
                {t('room.emptySeat')}
              </div>
            ))}
          </div>

          <div className="table__center">{center}</div>

          {showLog && (
            <div className="table__log">
              {room.log.slice(-6).map((event, index) => {
                const line = skin.formatLog(event);
                return <p key={`${index}-${line}`}>{line}</p>;
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn room__side-toggle"
          aria-expanded={chatOpen}
          onClick={() => setChatOpen((open) => !open)}
        >
          {unread > 0 ? t('room.chatUnread', { n: unread }) : t('room.chatToggle')}
        </button>

        <aside className="room__side" data-collapsed={chatOpen ? undefined : 'true'}>
          {isSpectator && allHands && (
            <section className="panel spectator">
              <h2>{t('room.godView')}</h2>
              {room.seats.map((seat) => (
                <div key={seat.playerId} className="spectator__row">
                  <span className="spectator__name">
                    {seat.nickname}
                    {game?.turnPlayerId === seat.playerId && (
                      <span className="tag tag--turn">{t('room.turnTag')}</span>
                    )}
                  </span>
                  <div className="spectator__cards">
                    {sortCards(allHands[seat.playerId] ?? []).map((card) => (
                      <PlayingCard key={card.id} card={card} small />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {room.spectators.length > 0 && (
            <section className="panel">
              <h2>{t('room.spectators', { n: room.spectators.length })}</h2>
              <p className="muted">{room.spectators.map((s) => s.nickname).join(', ')}</p>
            </section>
          )}

          <ChatPanel
            title={t('room.chatTitle')}
            messages={roomMessages}
            myPlayerId={me.playerId}
            onSend={(text) => socket.emit('room:chat', { text })}
          />
        </aside>
      </div>

      {!isSpectator && <footer className="room__footer">{footer}</footer>}
    </div>
  );
}
