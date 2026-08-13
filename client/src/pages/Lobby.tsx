import { useState, type FormEvent } from 'react';
import {
  BIG_TWO_PRESETS,
  BIG_TWO_PRESET_RULES,
  BIG_TWO_RULE_KEYS,
  DEFAULT_BIG_TWO_RULES,
  DEFAULT_MONOPOLY_OPTIONS,
  DEFAULT_SNAKE_OPTIONS,
  GAME_TYPES,
  MONOPOLY_OPTION_KEYS,
  MONOPOLY_OPTION_SPEC,
  SEAT_LIMITS,
  SNAKE_TIME_LIMIT_MAX_SEC,
  SNAKE_TIME_LIMIT_MIN_SEC,
  bigTwoPresetOf,
  type BigTwoRules,
  type GameType,
  type JoinMode,
  type MonopolyOptions,
  type RoomStatus,
  type SnakeOptions,
} from 'shared';
import { ChatPanel } from '../components/ChatPanel';
import { emitWithAck, getPlayerId, socket } from '../net/socket';
import { useGame } from '../state/GameProvider';
import { useSkin } from '../state/skinContext';
import { GAME_DISGUISABLE } from '../skins/disguise';
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
  const [bigTwoRules, setBigTwoRules] = useState<BigTwoRules>(DEFAULT_BIG_TWO_RULES);
  const [monopolyOptions, setMonopolyOptions] =
    useState<MonopolyOptions>(DEFAULT_MONOPOLY_OPTIONS);
  const [snakeOptions, setSnakeOptions] = useState<SnakeOptions>(DEFAULT_SNAKE_OPTIONS);
  const [joinCode, setJoinCode] = useState('');
  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  // 記住自己申請過哪些房間，按鈕才能從「申請加入」變成「已送出申請」
  const [requestedRooms, setRequestedRooms] = useState<Set<string>>(new Set());

  const limits = SEAT_LIMITS[gameType];
  const seatOptions = Array.from({ length: limits.max - limits.min + 1 }, (_, i) => limits.min + i);

  // 換玩法時人數上限跟著換，免得送出超出範圍的值
  const changeGameType = (next: GameType) => {
    setGameType(next);
    setMaxPlayers(SEAT_LIMITS[next].max);
  };

  // 套組只是一鍵套用五個開關；動過任何一項，選單就自己變成「自訂」
  const preset = bigTwoPresetOf(bigTwoRules);
  const applyPreset = (next: string) => {
    if (next === 'custom') return;
    setBigTwoRules(BIG_TWO_PRESET_RULES[next as 'taiwan' | 'classic']);
  };

  const createRoom = (event: FormEvent) => {
    event.preventDefault();
    run(() =>
      emitWithAck('room:create', {
        name: roomName.trim(),
        maxPlayers,
        gameType,
        bigTwoRules,
        monopolyOptions,
        snakeOptions,
      }),
    );
    setRoomName('');
  };

  const join = (roomId: string, mode: JoinMode) => {
    run(() => emitWithAck('room:join', { roomId, mode }));
  };

  const requestJoin = (roomId: string) => {
    run(async () => {
      await emitWithAck('room:requestJoin', { roomId });
      setRequestedRooms((prev) => new Set(prev).add(roomId));
    });
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
              {gameType === 'bigTwo' && (
                <select
                  value={preset}
                  onChange={(event) => applyPreset(event.target.value)}
                  aria-label={t('lobby.rulesLabel')}
                >
                  {BIG_TWO_PRESETS.map((item) => (
                    // 自訂只是顯示用的結果，選不了
                    <option key={item} value={item} disabled={item === 'custom'}>
                      {skin.bigTwoPreset[item]}
                    </option>
                  ))}
                </select>
              )}
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
            {!GAME_DISGUISABLE[gameType] && (
              <p className="lobby__warn">{t('lobby.noDisguiseHint')}</p>
            )}
            {gameType === 'bigTwo' && (
              <fieldset className="lobby__rules">
                <legend>{t('lobby.rulesOptionsLabel')}</legend>
                {BIG_TWO_RULE_KEYS.map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={bigTwoRules[key]}
                      onChange={(event) =>
                        setBigTwoRules({ ...bigTwoRules, [key]: event.target.checked })
                      }
                    />
                    {skin.bigTwoRule[key]}
                  </label>
                ))}
              </fieldset>
            )}
            {gameType === 'snake' && (
              <fieldset className="lobby__rules">
                <legend>{t('lobby.rulesOptionsLabel')}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={snakeOptions.wraparound}
                    onChange={(event) =>
                      setSnakeOptions({ ...snakeOptions, wraparound: event.target.checked })
                    }
                  />
                  {t('snake.optWraparound')}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snakeOptions.unlimitedLives}
                    onChange={(event) =>
                      setSnakeOptions({ ...snakeOptions, unlimitedLives: event.target.checked })
                    }
                  />
                  {t('snake.optUnlimitedLives')}
                </label>
                <label>
                  {t('snake.optTimeLimit')}
                  <input
                    type="number"
                    min={SNAKE_TIME_LIMIT_MIN_SEC}
                    max={SNAKE_TIME_LIMIT_MAX_SEC}
                    step={30}
                    disabled={!snakeOptions.unlimitedLives}
                    value={snakeOptions.unlimitedLivesTimeLimitSec}
                    onChange={(event) =>
                      setSnakeOptions({
                        ...snakeOptions,
                        unlimitedLivesTimeLimitSec: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snakeOptions.cutting}
                    onChange={(event) =>
                      setSnakeOptions({ ...snakeOptions, cutting: event.target.checked })
                    }
                  />
                  {t('snake.optCutting')}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snakeOptions.largeMap}
                    onChange={(event) =>
                      setSnakeOptions({ ...snakeOptions, largeMap: event.target.checked })
                    }
                  />
                  {t('snake.optLargeMap')}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snakeOptions.items}
                    onChange={(event) => setSnakeOptions({ ...snakeOptions, items: event.target.checked })}
                  />
                  {t('snake.optItems')}
                </label>
                <label>
                  {t('snake.optHeadOnCollision')}
                  <select
                    value={snakeOptions.headOnCollision}
                    onChange={(event) =>
                      setSnakeOptions({
                        ...snakeOptions,
                        headOnCollision: event.target.value as 'bounce' | 'clash',
                      })
                    }
                  >
                    <option value="bounce">{t('snake.optHeadBounce')}</option>
                    <option value="clash">{t('snake.optHeadClash')}</option>
                  </select>
                </label>
              </fieldset>
            )}
            {gameType === 'monopoly' && (
              <fieldset className="lobby__rules lobby__rules--monopoly">
                <legend>{t('lobby.rulesOptionsLabel')}</legend>
                {/* 整段由 MONOPOLY_OPTION_SPEC 生成，加選項不必回來改這裡 */}
                {MONOPOLY_OPTION_KEYS.map((key) => {
                  const spec = MONOPOLY_OPTION_SPEC[key];
                  return (
                    <label key={key}>
                      {spec.kind === 'flag' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(monopolyOptions[key])}
                          onChange={(event) =>
                            setMonopolyOptions({ ...monopolyOptions, [key]: event.target.checked })
                          }
                        />
                      ) : (
                        <input
                          type="number"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step}
                          value={Number(monopolyOptions[key])}
                          onChange={(event) =>
                            setMonopolyOptions({
                              ...monopolyOptions,
                              [key]: Number(event.target.value),
                            })
                          }
                        />
                      )}
                      {skin.monopolyOption[key]}
                    </label>
                  );
                })}
              </fieldset>
            )}
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
                // 只有麻將房會有電腦代打；房間滿位但有電腦座位時，改成「申請加入」頂替電腦
                const hasNpcSeat = room.gameType === 'taiwanMahjong' && room.npcCount > 0;
                const canRequestJoin = hasNpcSeat && full;
                const alreadyRequested = requestedRooms.has(room.id);
                return (
                  <li key={room.id} className="room-row">
                    <div className="room-row__main">
                      <span className="room-row__name">{room.name}</span>
                      <span className="room-row__code">#{room.id}</span>
                      <span className="tag tag--game">{skin.gameType[room.gameType]}</span>
                      {!GAME_DISGUISABLE[room.gameType] && (
                        <span className="tag tag--exposed">{t('lobby.noDisguise')}</span>
                      )}
                      {room.bigTwoRules && (
                        <span className="tag tag--rules">
                          {skin.bigTwoPreset[bigTwoPresetOf(room.bigTwoRules)]}
                        </span>
                      )}
                      <span className={`badge badge--${room.status}`}>
                        {t(STATUS_KEY[room.status])}
                      </span>
                    </div>
                    <div className="room-row__meta">
                      <span>{t('lobby.host', { name: room.hostNickname })}</span>
                      <span>
                        {hasNpcSeat
                          ? t('lobby.playerNpcCount', {
                              human: room.playerCount - room.npcCount,
                              npc: room.npcCount,
                              max: room.maxPlayers,
                            })
                          : t('lobby.playerCount', { n: room.playerCount, max: room.maxPlayers })}
                      </span>
                      {room.spectatorCount > 0 && (
                        <span>{t('lobby.spectatorCount', { n: room.spectatorCount })}</span>
                      )}
                    </div>
                    <div className="room-row__actions">
                      {canRequestJoin ? (
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={alreadyRequested}
                          onClick={() => requestJoin(room.id)}
                        >
                          {alreadyRequested ? t('lobby.requestJoinSent') : t('lobby.requestJoin')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={full || started}
                          title={started ? t('lobby.started') : full ? t('lobby.full') : undefined}
                          onClick={() => join(room.id, 'play')}
                        >
                          {t('lobby.join')}
                        </button>
                      )}
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
