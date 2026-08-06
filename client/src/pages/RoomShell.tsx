import type { ReactNode } from 'react';
import { BIG_TWO_RULE_KEYS, bigTwoPresetOf, sortCards, type RoomView } from 'shared';
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
}

/**
 * 房間的外殼：標題列、座位、戰報、側欄聊天。
 * 這些跟玩法無關，大老二與德州撲克共用。
 */
export function RoomShell({ room, center, footer, isMyTurn }: Props) {
  const { roomMessages, run } = useGame();
  const { skin, t } = useSkin();
  const game = room.game;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const allHands = room.allHands;

  const others = room.seats.filter((seat) => seat.playerId !== me.playerId);
  const rules = room.bigTwoRules;
  // 套組講得清楚就只掛套組名；自訂的話把開著的規則逐條列出來
  const rulePreset = rules && bigTwoPresetOf(rules);
  const ruleDetails =
    rules && rulePreset === 'custom' ? BIG_TWO_RULE_KEYS.filter((key) => rules[key]) : [];

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
                game={game}
                chips={room.chips?.[seat.playerId]}
              />
            ))}
            {Array.from({ length: room.maxPlayers - room.seats.length }, (_, i) => (
              <div key={`empty-${i}`} className="seat seat--empty">
                {t('room.emptySeat')}
              </div>
            ))}
          </div>

          <div className="table__center">{center}</div>

          <div className="table__log">
            {room.log.slice(-6).map((event, index) => {
              const line = skin.formatLog(event);
              return <p key={`${index}-${line}`}>{line}</p>;
            })}
          </div>
        </div>

        <aside className="room__side">
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
