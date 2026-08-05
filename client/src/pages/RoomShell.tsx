import type { ReactNode } from 'react';
import { GAME_TYPE_LABEL, sortCards, type RoomView } from 'shared';
import { ChatPanel } from '../components/ChatPanel';
import { PlayingCard } from '../components/PlayingCard';
import { Seat } from '../components/Seat';
import { emitWithAck, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';

interface Props {
  room: RoomView;
  /** 牌桌中央，由各玩法自己畫。 */
  center: ReactNode;
  /** 底部控制列，觀戰者不會看到。 */
  footer: ReactNode;
}

/**
 * 房間的外殼：標題列、座位、戰報、側欄聊天。
 * 這些跟玩法無關，大老二與德州撲克共用。
 */
export function RoomShell({ room, center, footer }: Props) {
  const { roomMessages, run } = useGame();
  const game = room.game;
  const me = room.me;
  const isSpectator = me.mode === 'spectate';
  const playing = room.status === 'playing';
  const allHands = room.allHands;

  const others = room.seats.filter((seat) => seat.playerId !== me.playerId);

  return (
    <div className="room">
      <header className="room__header">
        <div>
          <h1>{room.name}</h1>
          <span className="room__code">房號 #{room.id}</span>
          <span className="tag tag--game">{GAME_TYPE_LABEL[room.gameType]}</span>
          {isSpectator && <span className="tag tag--spectator">觀戰中</span>}
        </div>
        <div className="room__header-actions">
          {isSpectator && room.seats.length < room.maxPlayers && !playing && (
            <button
              type="button"
              className="btn"
              onClick={() => run(() => emitWithAck('room:join', { roomId: room.id, mode: 'play' }))}
            >
              坐下來玩
            </button>
          )}
          {!isSpectator && !playing && (
            <button
              type="button"
              className="btn"
              onClick={() => run(() => emitWithAck('room:join', { roomId: room.id, mode: 'spectate' }))}
            >
              改為觀戰
            </button>
          )}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => run(() => emitWithAck('room:leave', {}))}
          >
            離開房間
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
                空位
              </div>
            ))}
          </div>

          <div className="table__center">{center}</div>

          <div className="table__log">
            {room.log.slice(-6).map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
          </div>
        </div>

        <aside className="room__side">
          {isSpectator && allHands && (
            <section className="panel spectator">
              <h2>上帝視角</h2>
              {room.seats.map((seat) => (
                <div key={seat.playerId} className="spectator__row">
                  <span className="spectator__name">
                    {seat.nickname}
                    {game?.turnPlayerId === seat.playerId && <span className="tag tag--turn">輪到</span>}
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
              <h2>觀戰者（{room.spectators.length}）</h2>
              <p className="muted">{room.spectators.map((s) => s.nickname).join('、')}</p>
            </section>
          )}

          <ChatPanel
            title="房間聊天"
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
