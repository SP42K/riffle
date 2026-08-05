import { useState, type FormEvent } from 'react';
import { GAME_TYPES, SEAT_LIMITS, type GameType, type JoinMode, type RoomStatus } from 'shared';
import { ChatPanel } from '../components/ChatPanel';
import { emitWithAck, getPlayerId, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import type { TextKey } from '../skins/text';

const STATUS_KEY: Record<RoomStatus, TextKey> = {
  waiting: 'lobby.status.waiting',
  playing: 'lobby.status.playing',
  finished: 'lobby.status.finished',
};

export function Lobby() {
  const { rooms, lobbyMessages, nickname, saveNickname, run, connected } = useGame();
  const { skin, t } = useSkin();
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
          {t('gate.title')} <span className="lobby__header-en">{t('gate.titleAccent')}</span>
        </h1>
        <form
          className="lobby__nickname"
          onSubmit={(event) => {
            event.preventDefault();
            saveNickname(nicknameDraft);
          }}
        >
          <label htmlFor="nickname">{t('lobby.nicknameLabel')}</label>
          <input
            id="nickname"
            value={nicknameDraft}
            onChange={(event) => setNicknameDraft(event.target.value)}
            maxLength={12}
          />
          <button type="submit" disabled={!nicknameDraft.trim() || nicknameDraft.trim() === nickname}>
            {t('lobby.rename')}
          </button>
          <span
            className={connected ? 'dot dot--on' : 'dot dot--off'}
            title={connected ? t('lobby.connected') : t('lobby.connecting')}
          />
        </form>
      </header>

      <div className="lobby__body">
        <main className="lobby__rooms">
          <form className="panel lobby__create" onSubmit={createRoom}>
            <h2>{t('lobby.createTitle')}</h2>
            <div className="lobby__create-row">
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder={t('lobby.roomNamePlaceholder', { name: nickname })}
                maxLength={20}
              />
              <select
                value={gameType}
                onChange={(event) => changeGameType(event.target.value as GameType)}
                aria-label={t('lobby.gameTypeLabel')}
              >
                {GAME_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {skin.gameType[type]}
                  </option>
                ))}
              </select>
              <select
                value={maxPlayers}
                onChange={(event) => setMaxPlayers(Number(event.target.value))}
                aria-label={t('lobby.maxPlayersLabel')}
              >
                {seatOptions.map((n) => (
                  <option key={n} value={n}>
                    {t('lobby.seatOption', { n })}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn--primary">
                {t('lobby.create')}
              </button>
            </div>
          </form>

          <form className="panel lobby__code" onSubmit={joinByCode}>
            <h2>{t('lobby.codeTitle')}</h2>
            <div className="lobby__create-row">
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder={t('lobby.codePlaceholder')}
                maxLength={8}
              />
              <button type="submit" className="btn">
                {t('lobby.join')}
              </button>
            </div>
          </form>

          <section className="panel lobby__list">
            <h2>{t('lobby.listTitle', { n: rooms.length })}</h2>
            {rooms.length === 0 && <p className="muted">{t('lobby.empty')}</p>}
            <ul>
              {rooms.map((room) => {
                const full = room.playerCount >= room.maxPlayers;
                const started = room.status !== 'waiting';
                return (
                  <li key={room.id} className="room-row">
                    <div className="room-row__main">
                      <span className="room-row__name">{room.name}</span>
                      <span className="room-row__code">#{room.id}</span>
                      <span className="tag tag--game">{skin.gameType[room.gameType]}</span>
                      <span className={`badge badge--${room.status}`}>
                        {t(STATUS_KEY[room.status])}
                      </span>
                    </div>
                    <div className="room-row__meta">
                      <span>{t('lobby.host', { name: room.hostNickname })}</span>
                      <span>{t('lobby.playerCount', { n: room.playerCount, max: room.maxPlayers })}</span>
                      {room.spectatorCount > 0 && (
                        <span>{t('lobby.spectatorCount', { n: room.spectatorCount })}</span>
                      )}
                    </div>
                    <div className="room-row__actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={full || started}
                        title={started ? t('lobby.started') : full ? t('lobby.full') : undefined}
                        onClick={() => join(room.id, 'play')}
                      >
                        {t('lobby.join')}
                      </button>
                      <button type="button" className="btn" onClick={() => join(room.id, 'spectate')}>
                        {t('lobby.spectate')}
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
            title={t('chat.lobbyTitle')}
            messages={lobbyMessages}
            myPlayerId={getPlayerId()}
            onSend={(text) => socket.emit('lobby:chat', { text })}
          />
        </aside>
      </div>
    </div>
  );
}
