import { useState, type FormEvent } from 'react';
import {
  GAME_TYPES,
  GAME_TYPE_LABEL,
  SEAT_LIMITS,
  type GameType,
  type JoinMode,
  type RoomStatus,
} from 'shared';
import { ChatPanel } from '../components/ChatPanel';
import { emitWithAck, getPlayerId, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';

const STATUS_LABEL: Record<RoomStatus, string> = {
  waiting: '等待中',
  playing: '遊戲中',
  finished: '已結束',
};

export function Lobby() {
  const { rooms, lobbyMessages, nickname, saveNickname, run, connected } = useGame();
  const [roomName, setRoomName] = useState('');
  const [gameType, setGameType] = useState<GameType>('bigTwo');
  const [maxPlayers, setMaxPlayers] = useState(SEAT_LIMITS.bigTwo.max);
  const [joinCode, setJoinCode] = useState('');
  const [nicknameDraft, setNicknameDraft] = useState(nickname);

  const limits = SEAT_LIMITS[gameType];
  const seatOptions = Array.from({ length: limits.max - limits.min + 1 }, (_, i) => limits.min + i);

  // 換玩法時人數上限跟著換，免得送出超出範圍的值
  const changeGameType = (next: GameType) => {
    setGameType(next);
    setMaxPlayers(SEAT_LIMITS[next].max);
  };

  const createRoom = (event: FormEvent) => {
    event.preventDefault();
    run(() => emitWithAck('room:create', { name: roomName.trim(), maxPlayers, gameType }));
    setRoomName('');
  };

  const join = (roomId: string, mode: JoinMode) => {
    run(() => emitWithAck('room:join', { roomId, mode }));
  };

  const joinByCode = (event: FormEvent) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code) join(code, 'play');
    setJoinCode('');
  };

  return (
    <div className="lobby">
      <header className="lobby__header">
        <h1>
          線上牌桌 <span className="lobby__header-en">Online</span>
        </h1>
        <form
          className="lobby__nickname"
          onSubmit={(event) => {
            event.preventDefault();
            saveNickname(nicknameDraft);
          }}
        >
          <label htmlFor="nickname">暱稱</label>
          <input
            id="nickname"
            value={nicknameDraft}
            onChange={(event) => setNicknameDraft(event.target.value)}
            maxLength={12}
          />
          <button type="submit" disabled={!nicknameDraft.trim() || nicknameDraft.trim() === nickname}>
            更名
          </button>
          <span className={connected ? 'dot dot--on' : 'dot dot--off'} title={connected ? '已連線' : '連線中…'} />
        </form>
      </header>

      <div className="lobby__body">
        <main className="lobby__rooms">
          <form className="panel lobby__create" onSubmit={createRoom}>
            <h2>建立房間</h2>
            <div className="lobby__create-row">
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder={`${nickname} 的房間`}
                maxLength={20}
              />
              <select
                value={gameType}
                onChange={(event) => changeGameType(event.target.value as GameType)}
                aria-label="玩法"
              >
                {GAME_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {GAME_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
              <select
                value={maxPlayers}
                onChange={(event) => setMaxPlayers(Number(event.target.value))}
                aria-label="人數上限"
              >
                {seatOptions.map((n) => (
                  <option key={n} value={n}>
                    {n} 人
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn--primary">
                開房
              </button>
            </div>
          </form>

          <form className="panel lobby__code" onSubmit={joinByCode}>
            <h2>用房號加入</h2>
            <div className="lobby__create-row">
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="例如 K7QM"
                maxLength={8}
              />
              <button type="submit" className="btn">
                加入
              </button>
            </div>
          </form>

          <section className="panel lobby__list">
            <h2>房間列表（{rooms.length}）</h2>
            {rooms.length === 0 && <p className="muted">目前沒有房間，開一間吧。</p>}
            <ul>
              {rooms.map((room) => {
                const full = room.playerCount >= room.maxPlayers;
                const started = room.status !== 'waiting';
                return (
                  <li key={room.id} className="room-row">
                    <div className="room-row__main">
                      <span className="room-row__name">{room.name}</span>
                      <span className="room-row__code">#{room.id}</span>
                      <span className="tag tag--game">{GAME_TYPE_LABEL[room.gameType]}</span>
                      <span className={`badge badge--${room.status}`}>{STATUS_LABEL[room.status]}</span>
                    </div>
                    <div className="room-row__meta">
                      <span>房主 {room.hostNickname}</span>
                      <span>
                        {room.playerCount}/{room.maxPlayers} 人
                      </span>
                      {room.spectatorCount > 0 && <span>觀戰 {room.spectatorCount}</span>}
                    </div>
                    <div className="room-row__actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={full || started}
                        title={started ? '這局已開打' : full ? '房間已滿' : undefined}
                        onClick={() => join(room.id, 'play')}
                      >
                        加入
                      </button>
                      <button type="button" className="btn" onClick={() => join(room.id, 'spectate')}>
                        觀戰
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </main>

        <aside className="lobby__chat">
          <ChatPanel
            title="大廳聊天"
            messages={lobbyMessages}
            myPlayerId={getPlayerId()}
            onSend={(text) => socket.emit('lobby:chat', { text })}
          />
        </aside>
      </div>
    </div>
  );
}
