import type { Server, Socket } from 'socket.io';
import {
  DISCONNECT_GRACE_MS,
  HOLDEM_SHOWDOWN_MS,
  HOLDEM_START_CHIPS,
  MONOPOLY_ACTION_KINDS,
  MONOPOLY_ESTATE_IDS,
  SEAT_LIMITS,
  SNAKE_DIRECTIONS,
  SNAKE_TICK_MS,
  TURN_MS,
  type Ack,
  type BetAction,
  type Card,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinMode,
  type MonopolyAction,
  type MonopolyEstateId,
  type PlayerId,
  type ServerToClientEvents,
  type SystemNotice,
  activateDownstairsSkill,
  advanceDownstairs,
  downstairsView,
  removeDownstairsPlayer,
  setDownstairsDirection,
  startDownstairs,
  DOWNSTAIRS_CHARACTERS,
  DOWNSTAIRS_TICK_MS,
  type MinesweeperAction,
  type DndAction,
  type DndRole,
  DND_BOSS_SEAT,
} from 'shared';
import {
  PLAY_ERROR_MESSAGE,
  autoAct,
  dealGame,
  passTurn,
  playCards,
  removePlayerFromGame,
} from './gameEngine.js';
import {
  MINESWEEPER_ERROR_MESSAGE,
  applyMinesweeperAction,
  autoActMinesweeper,
  dealMinesweeper,
  removePlayerFromMinesweeper,
} from './minesweeperEngine.js';
import {
  DND_ERROR_MESSAGE,
  applyDndAction,
  autoActDnd,
  dealDnd,
  openingDndTurn,
  removePlayerFromDnd,
} from './dndEngine.js';
import {
  BET_ERROR_MESSAGE,
  applyBet,
  autoActHoldem,
  nextButtonSeat,
  removePlayerFromHoldem,
  startHand,
  type HoldemState,
} from './holdemEngine.js';
import {
  MONOPOLY_ERROR_MESSAGE,
  applyMonopolyAction,
  autoActMonopoly,
  removePlayerFromMonopoly,
  startMonopoly,
  type MonopolyEvent,
} from './monopolyEngine.js';
import {
  addSpectator,
  buildRoomView,
  buildSummary,
  canStart,
  clampMaxPlayers,
  createRoom,
  fundedCount,
  generateRoomId,
  isEmpty,
  makeChatMessage,
  makeSystemMessage,
  memberOf,
  modeOf,
  monopolyLogOf,
  nicknameOf,
  normalizeBigTwoRules,
  normalizeGameType,
  bossSeatOf,
  freeSeatOf,
  swapSeats,
  normalizeDndDifficulty,
  normalizeMonopolyOptions,
  pushChat,
  pushLog,
  refillChips,
  removeMember,
  seatPlayer,
  seatedPlayers,
  snakeLogOf,
  statusOf,
  type Member,
  type Room,
} from './rooms.js';
import {
  initSnake,
  removePlayerFromSnake,
  setSnakeDirection,
  tickSnake,
  type SnakeEvent,
} from './snakeEngine.js';
import { assertNeverGame } from './turnBased.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameIo = Server<ClientToServerEvents, ServerToClientEvents>;

const LOBBY = 'lobby';
const roomChannel = (roomId: string) => `room:${roomId}`;

/** 斷線的人輪到時不用等滿 45 秒，短暫等一下就代打。 */
const DISCONNECTED_TURN_MS = 3_000;

const BET_ACTIONS: readonly BetAction[] = ['fold', 'check', 'call', 'raise', 'allin'];

interface Session {
  playerId: PlayerId;
  nickname: string;
  roomId: string | null;
}

/** 戰報只送牌的 id，文字寫法交給前端的外觀決定。 */
function cardIdsOf(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id);
}

function cleanText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanNumber(input: unknown): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) ? n : 0;
}

function cleanEstateId(input: unknown): MonopolyEstateId | null {
  return MONOPOLY_ESTATE_IDS.find((id) => id === input) ?? null;
}

function cleanEstateIds(input: unknown): MonopolyEstateId[] | null {
  if (!Array.isArray(input)) return null;
  const ids: MonopolyEstateId[] = [];
  for (const raw of input) {
    const id = cleanEstateId(raw);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * 把來路不明的 payload 收成 MonopolyAction。
 * 認不得的 kind、缺欄位、格子代號不存在 —— 一律回 null，由呼叫端吐 BAD_ACTION。
 */
function parseMonopolyAction(value: unknown): MonopolyAction | null {
  const input = (value ?? {}) as { kind?: unknown };
  const kind = MONOPOLY_ACTION_KINDS.find((k) => k === input.kind);
  if (!kind) return null;

  switch (kind) {
    case 'roll':
    case 'buy':
    case 'decline':
    case 'passBid':
    case 'payBail':
    case 'useJailCard':
    case 'rollForDoubles':
    case 'declareBankrupt':
    case 'endTurn':
      return { kind };

    case 'bid':
      return { kind, amount: cleanNumber((input as { amount?: unknown }).amount) };

    case 'build':
    case 'sellHouse':
    case 'mortgage':
    case 'unmortgage': {
      const tile = cleanEstateId((input as { tile?: unknown }).tile);
      return tile ? { kind, tile } : null;
    }

    case 'respondTrade':
      return { kind, accept: (input as { accept?: unknown }).accept === true };

    case 'offerTrade': {
      const raw = input as {
        to?: unknown;
        give?: unknown;
        want?: unknown;
        giveCash?: unknown;
        wantCash?: unknown;
      };
      const to = cleanText(raw.to, 64);
      const give = cleanEstateIds(raw.give);
      const want = cleanEstateIds(raw.want);
      if (!to || !give || !want) return null;
      return {
        kind,
        to,
        give,
        want,
        giveCash: cleanNumber(raw.giveCash),
        wantCash: cleanNumber(raw.wantCash),
      };
    }
  }
}

function reply<T>(ack: unknown, payload: Parameters<Ack<T>>[0]): void {
  if (typeof ack === 'function') (ack as Ack<T>)(payload);
}

export class GameServer {
  private readonly rooms = new Map<string, Room>();
  private readonly lobbyChat: ChatMessage[] = [];
  /** socket.id → session */
  private readonly sessions = new Map<string, Session>();
  /** playerId → 目前所在房間，斷線寬限期內也保留著，才能無縫接回。 */
  private readonly playerRoom = new Map<PlayerId, string>();
  /** 德州撲克：已經寫過戰報的手數，避免同一手被重複結算播報。 */
  private readonly loggedHand = new Map<string, number>();

  constructor(private readonly io: GameIo) {
    io.on('connection', (socket) => this.register(socket));
  }

  // -------------------------------------------------------------------------
  // 事件註冊
  // -------------------------------------------------------------------------

  private register(socket: GameSocket): void {
    socket.on('session:hello', (payload, ack) => this.onHello(socket, payload, ack));
    socket.on('lobby:chat', (payload) => this.onLobbyChat(socket, payload));
    socket.on('room:create', (payload, ack) => this.onCreateRoom(socket, payload, ack));
    socket.on('room:join', (payload, ack) => this.onJoinRoom(socket, payload, ack));
    socket.on('room:leave', (_payload, ack) => this.onLeaveRoom(socket, ack));
    socket.on('room:chat', (payload) => this.onRoomChat(socket, payload));
    socket.on('room:ready', (payload) => this.onReady(socket, payload));
    socket.on('room:character', (payload) => this.onCharacter(socket, payload));
    socket.on('game:start', (_payload, ack) => this.onStartGame(socket, ack));
    socket.on('game:play', (payload, ack) => this.onPlay(socket, payload, ack));
    socket.on('game:pass', (_payload, ack) => this.onPass(socket, ack));
    socket.on('game:action', (payload, ack) => this.onAction(socket, payload, ack));
    socket.on('game:monopoly', (payload, ack) => this.onMonopoly(socket, payload, ack));
    socket.on('game:downstairs', (payload) => this.onDownstairs(socket, payload));
    socket.on('game:downstairsSkill', () => this.onDownstairsSkill(socket));
    socket.on('game:snake', (payload, ack) => this.onSnake(socket, payload, ack));
    socket.on('game:minesweeper', (payload, ack) => this.onMinesweeper(socket, payload, ack));
    socket.on('game:dnd', (payload, ack) => this.onDnd(socket, payload, ack));
    socket.on('room:dndDifficulty', (payload) => this.onDndDifficulty(socket, payload));
    socket.on('room:dndRole', (payload) => this.onDndRole(socket, payload));
    socket.on('disconnect', () => this.onDisconnect(socket));
  }

  // -------------------------------------------------------------------------
  // 連線 / 重連
  // -------------------------------------------------------------------------

  private onHello(
    socket: GameSocket,
    payload: { playerId?: unknown; nickname?: unknown },
    ack: unknown,
  ): void {
    const playerId = cleanText(payload?.playerId, 64);
    const nickname = cleanText(payload?.nickname, 12) || '玩家';

    if (!playerId) {
      reply(ack, { ok: false, error: { code: 'BAD_SESSION', message: '缺少玩家識別碼' } });
      return;
    }

    // 同一個 playerId 從別的分頁連進來，踢掉舊連線避免兩邊互搶
    for (const [oldSocketId, session] of this.sessions) {
      if (session.playerId === playerId && oldSocketId !== socket.id) {
        this.sessions.delete(oldSocketId);
        this.io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }
    }

    const roomId = this.playerRoom.get(playerId) ?? null;
    const room = roomId ? this.rooms.get(roomId) : undefined;

    this.sessions.set(socket.id, { playerId, nickname, roomId: room ? room.id : null });

    if (room) {
      this.reattach(socket, room, playerId, nickname);
      reply(ack, { ok: true, data: { roomId: room.id } });
      return;
    }

    this.playerRoom.delete(playerId);
    this.enterLobby(socket);
    reply(ack, { ok: true, data: { roomId: null } });
  }

  /** 斷線重連：接回原本的座位與手牌。 */
  private reattach(socket: GameSocket, room: Room, playerId: PlayerId, nickname: string): void {
    const member = memberOf(room, playerId);
    if (!member) {
      // 寬限期已過被清掉了，退回大廳
      this.playerRoom.delete(playerId);
      const session = this.sessions.get(socket.id);
      if (session) session.roomId = null;
      this.enterLobby(socket);
      return;
    }

    if (member.graceTimer) {
      clearTimeout(member.graceTimer);
      member.graceTimer = null;
    }
    member.socketId = socket.id;
    member.connected = true;
    member.nickname = nickname;

    socket.leave(LOBBY);
    socket.join(roomChannel(room.id));

    // 斷線時把回合縮短成 3 秒，回來了要把整個回合還給他，否則一重整就被自動代打
    const game = room.game;
    if (game && game.type !== 'downstairs' && !game.state.over && room.seats[game.state.turnSeat] === playerId) {
      game.state.turnDeadline = Date.now() + TURN_MS;
    }

    socket.emit('room:chat', { messages: room.chat });
    this.broadcastRoom(room);
    this.broadcastLobby();
    this.scheduleTurn(room);
  }

  private enterLobby(socket: GameSocket): void {
    socket.join(LOBBY);
    socket.emit('room:state', null);
    socket.emit('lobby:chat', { messages: this.lobbyChat });
    socket.emit('lobby:state', { rooms: this.lobbySnapshot() });
  }

  private onDisconnect(socket: GameSocket): void {
    const session = this.sessions.get(socket.id);
    this.sessions.delete(socket.id);
    if (!session?.roomId) return;

    const room = this.rooms.get(session.roomId);
    if (!room) return;

    const member = memberOf(room, session.playerId);
    if (!member || member.socketId !== socket.id) return; // 已經被新連線接手

    member.connected = false;
    member.socketId = null;
    member.graceTimer = setTimeout(() => {
      member.graceTimer = null;
      this.dropFromRoom(room, session.playerId, 'disconnected');
    }, DISCONNECT_GRACE_MS);

    this.broadcastRoom(room);
    this.scheduleTurn(room); // 換成短計時，避免整桌等他 45 秒
  }

  // -------------------------------------------------------------------------
  // 大廳
  // -------------------------------------------------------------------------

  private lobbySnapshot() {
    return [...this.rooms.values()].map(buildSummary);
  }

  private broadcastLobby(): void {
    this.io.to(LOBBY).emit('lobby:state', { rooms: this.lobbySnapshot() });
  }

  private onLobbyChat(socket: GameSocket, payload: { text?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session || session.roomId) return; // 房間內的人講話走 room:chat
    const text = cleanText(payload?.text, 200);
    if (!text) return;

    pushChat(this.lobbyChat, makeChatMessage(session.nickname, text, session.playerId));
    this.io.to(LOBBY).emit('lobby:chat', { messages: this.lobbyChat });
  }

  // -------------------------------------------------------------------------
  // 房間
  // -------------------------------------------------------------------------

  private broadcastRoom(room: Room): void {
    for (const member of [...room.players.values(), ...room.spectators.values()]) {
      if (!member.socketId) continue;
      const socket = this.io.sockets.sockets.get(member.socketId);
      socket?.emit('room:state', buildRoomView(room, member.playerId));
    }
  }

  private broadcastRoomChat(room: Room): void {
    this.io.to(roomChannel(room.id)).emit('room:chat', { messages: room.chat });
  }

  private systemNotice(room: Room, notice: SystemNotice): void {
    pushChat(room.chat, makeSystemMessage(notice));
    this.broadcastRoomChat(room);
  }

  private memberFromSession(session: Session): Member {
    return {
      playerId: session.playerId,
      nickname: session.nickname,
      socketId: null,
      connected: true,
      graceTimer: null,
      characterId: 'brave',
      dndRole: 'hero',
    };
  }

  private onCreateRoom(
    socket: GameSocket,
    payload: {
      name?: unknown;
      maxPlayers?: unknown;
      gameType?: unknown;
      bigTwoRules?: unknown;
      monopolyOptions?: unknown;
    },
    ack: unknown,
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session) return reply(ack, { ok: false, error: { code: 'BAD_SESSION', message: '請先連線' } });
    if (session.roomId) {
      return reply(ack, { ok: false, error: { code: 'ALREADY_IN_ROOM', message: '你已經在房間裡' } });
    }

    const name = cleanText(payload?.name, 20) || `${session.nickname} 的房間`;
    const gameType = normalizeGameType(payload?.gameType);
    const maxPlayers = clampMaxPlayers(payload?.maxPlayers, gameType);
    const bigTwoRules = normalizeBigTwoRules(payload?.bigTwoRules);
    const monopolyOptions = normalizeMonopolyOptions(payload?.monopolyOptions);
    const id = generateRoomId((candidate) => this.rooms.has(candidate));

    const host = this.memberFromSession(session);
    host.socketId = socket.id;
    const room = createRoom({
      id,
      name,
      gameType,
      maxPlayers,
      bigTwoRules,
      monopolyOptions,
      host,
    });
    this.rooms.set(id, room);

    session.roomId = id;
    this.playerRoom.set(session.playerId, id);
    socket.leave(LOBBY);
    socket.join(roomChannel(id));

    this.systemNotice(room, { t: 'created', player: session.nickname });
    this.broadcastRoom(room);
    this.broadcastLobby();
    reply(ack, { ok: true, data: { roomId: id } });
  }

  private onJoinRoom(
    socket: GameSocket,
    payload: { roomId?: unknown; mode?: unknown },
    ack: unknown,
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session) return reply(ack, { ok: false, error: { code: 'BAD_SESSION', message: '請先連線' } });

    const roomId = cleanText(payload?.roomId, 16).toUpperCase();
    const mode: JoinMode = payload?.mode === 'spectate' ? 'spectate' : 'play';
    const room = this.rooms.get(roomId);
    if (!room) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '找不到這個房間' } });

    // 已經在別的房間就先退出
    if (session.roomId && session.roomId !== roomId) this.leaveCurrentRoom(socket, session);

    const currentMode = modeOf(room, session.playerId);
    if (currentMode === mode) return reply(ack, { ok: true, data: { roomId } });

    if (mode === 'play') {
      if (statusOf(room) === 'playing') {
        return reply(ack, {
          ok: false,
          error: { code: 'IN_PROGRESS', message: '這局已經開打了，可以先觀戰' },
        });
      }
      // 用 freeSeatOf 而不是「座位陣列填滿了沒」—— 龍與地下城的魔王位不開放自動入座
      if (freeSeatOf(room) === -1) {
        return reply(ack, { ok: false, error: { code: 'ROOM_FULL', message: '房間已滿，可以先觀戰' } });
      }
    }

    const member = currentMode ? memberOf(room, session.playerId)! : this.memberFromSession(session);
    member.socketId = socket.id;
    member.connected = true;
    member.nickname = session.nickname;
    if (currentMode) removeMember(room, session.playerId);

    if (mode === 'play') {
      seatPlayer(room, member);
    } else {
      // 遊戲中改當觀眾等同棄牌
      this.removeFromGame(room, session.playerId);
      addSpectator(room, member);
    }

    session.roomId = roomId;
    this.playerRoom.set(session.playerId, roomId);
    socket.leave(LOBBY);
    socket.join(roomChannel(roomId));

    socket.emit('room:chat', { messages: room.chat });
    this.systemNotice(room, {
      t: mode === 'play' ? 'joined' : 'spectating',
      player: session.nickname,
    });
    this.broadcastRoom(room);
    this.broadcastLobby();
    this.scheduleTurn(room);
    reply(ack, { ok: true, data: { roomId } });
  }

  private onLeaveRoom(socket: GameSocket, ack: unknown): void {
    const session = this.sessions.get(socket.id);
    if (!session) return reply(ack, { ok: false, error: { code: 'BAD_SESSION', message: '請先連線' } });
    this.leaveCurrentRoom(socket, session);
    this.enterLobby(socket);
    reply(ack, { ok: true, data: null });
  }

  private leaveCurrentRoom(socket: GameSocket, session: Session): void {
    if (!session.roomId) return;
    const room = this.rooms.get(session.roomId);
    session.roomId = null;
    socket.leave(room ? roomChannel(room.id) : roomChannel(''));
    if (room) this.dropFromRoom(room, session.playerId, 'left');
  }

  /** 把玩家徹底移出房間（主動離開或斷線寬限到期）。 */
  private dropFromRoom(room: Room, playerId: PlayerId, reason: 'left' | 'disconnected'): void {
    if (!modeOf(room, playerId)) return;
    const nickname = nicknameOf(room, playerId);

    if (room.players.has(playerId)) this.removeFromGame(room, playerId);
    removeMember(room, playerId);
    this.playerRoom.delete(playerId);

    if (isEmpty(room)) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      if (room.handTimer) clearTimeout(room.handTimer);
      if (room.gameTimer) clearInterval(room.gameTimer);
      if (room.tickTimer) clearTimeout(room.tickTimer);
      this.rooms.delete(room.id);
      this.loggedHand.delete(room.id);
      this.broadcastLobby();
      return;
    }

    this.systemNotice(room, { t: reason, player: nickname });
    this.afterGameAction(room);
  }

  /** 讓玩家從進行中的牌局退出：大老二是抽掉手牌，德州撲克視同蓋牌，大富翁是地產還給銀行。 */
  private removeFromGame(room: Room, playerId: PlayerId): void {
    const game = room.game;
    if (!game || game.state.over) return;
    switch (game.type) {
      case 'bigTwo':
        removePlayerFromGame(room.seats, game.state, playerId);
        return;
      case 'holdem':
        removePlayerFromHoldem(room.seats, game.state, playerId);
        return;
      case 'monopoly':
        this.logMonopoly(room, removePlayerFromMonopoly(room.seats, game.state, playerId));
        return;
      case 'downstairs':
        removeDownstairsPlayer(game.state, playerId);
        return;
      case 'snake':
        this.logSnake(room, removePlayerFromSnake(game.state, playerId));
        return;
      case 'minesweeper':
        removePlayerFromMinesweeper(room.seats, game.state, playerId);
        return;
      case 'dnd':
        // 魔王中離會代打完一整輪怪物行動，那些事件要寫進戰報
        for (const ev of removePlayerFromDnd(room.seats, game.state, playerId)) pushLog(room, ev);
        return;
      default:
        assertNeverGame(game);
    }
  }

  /** 引擎事件換上暱稱寫進戰報。 */
  private logMonopoly(room: Room, events: readonly MonopolyEvent[]): void {
    for (const event of events) pushLog(room, monopolyLogOf(room, event));
  }

  /** 跟 logMonopoly 同一個道理，貪吃蛇的事件種類少很多。 */
  private logSnake(room: Room, events: readonly SnakeEvent[]): void {
    for (const event of events) pushLog(room, snakeLogOf(room, event));
  }

  private onRoomChat(socket: GameSocket, payload: { text?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room) return;
    const text = cleanText(payload?.text, 200);
    if (!text) return;

    pushChat(room.chat, makeChatMessage(session.nickname, text, session.playerId));
    this.broadcastRoomChat(room);
  }

  private onReady(socket: GameSocket, payload: { ready?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    const player = room?.players.get(session.playerId);
    if (!room || !player) return;

    player.ready = payload?.ready === true;
    this.broadcastRoom(room);
  }

  private onCharacter(socket: GameSocket, payload: { characterId?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    const player = room?.players.get(session.playerId);
    if (!room || !player || (room.gameType !== 'downstairs' && room.gameType !== 'dnd') || statusOf(room) === 'playing') return;
    const characterId = DOWNSTAIRS_CHARACTERS.find((id) => id === payload?.characterId);
    if (!characterId) return;
    player.characterId = characterId;
    this.broadcastRoom(room);
  }

  /**
   * 選擇當冒險者還是魔王。一間房最多一位魔王，而且會被換到最後一個座位 ——
   * 引擎裡「隊伍就是座位 0~3」的假設靠這個維持。
   */
  private onDndRole(socket: GameSocket, payload: { role?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    const player = room?.players.get(session.playerId);
    if (!room || !player || room.gameType !== 'dnd' || statusOf(room) === 'playing') return;

    const role: DndRole = payload?.role === 'boss' ? 'boss' : 'hero';
    if (role === player.dndRole) return;

    const seat = room.seats.indexOf(session.playerId);
    if (seat === -1) return;

    if (role === 'boss') {
      // 已經有人當魔王就不受理。認的是「座位」不是旗子 —— bossSeatOf 才是唯一的真相
      if (bossSeatOf(room) !== null) return;
      swapSeats(room, seat, DND_BOSS_SEAT);
    } else {
      // 放回前面第一個空的冒險者位。沒有空位就不能放棄魔王 ——
      // 讓他留在 DND_BOSS_SEAT 卻標成冒險者的話，dealDnd 不會發給他棋子，整局都輪不到他。
      const free = room.seats.findIndex((id, idx) => idx < DND_BOSS_SEAT && !id);
      if (free === -1) return;
      swapSeats(room, seat, free);
    }

    player.dndRole = role;
    this.broadcastRoom(room);
  }

  /** 難度是房主的決定，而且只能在開局前改。 */
  private onDndDifficulty(socket: GameSocket, payload: { difficulty?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room || room.gameType !== 'dnd') return;
    if (room.hostId !== session.playerId || statusOf(room) === 'playing') return;

    room.dndDifficulty = normalizeDndDifficulty(payload?.difficulty);
    this.broadcastRoom(room);
  }

  // -------------------------------------------------------------------------
  // 遊戲
  // -------------------------------------------------------------------------

  private onStartGame(socket: GameSocket, ack: unknown): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '你不在房間裡' } });
    const room = this.rooms.get(session.roomId);
    if (!room) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '找不到房間' } });

    if (room.hostId !== session.playerId) {
      return reply(ack, { ok: false, error: { code: 'NOT_HOST', message: '只有房主可以開始遊戲' } });
    }
    if (statusOf(room) === 'playing') {
      return reply(ack, { ok: false, error: { code: 'IN_PROGRESS', message: '這局還在進行中' } });
    }
    if (!canStart(room)) {
      const min = SEAT_LIMITS[room.gameType].min;
      return reply(ack, {
        ok: false,
        error: { code: 'NOT_READY', message: `需要至少 ${min} 位玩家，且所有人都按下準備` },
      });
    }

    room.log = [];
    for (const player of room.players.values()) player.ready = false;

    switch (room.gameType) {
      case 'bigTwo': {
        const state = dealGame(room.seats, room.bigTwoRules);
        room.game = { type: 'bigTwo', state };
        pushLog(room, { t: 'bigTwoStart', players: seatedPlayers(room).length });
        const leader = room.seats[state.turnSeat];
        if (leader) pushLog(room, { t: 'lead', player: nicknameOf(room, leader) });
        break;
      }
      case 'holdem':
        this.startHoldemHand(room);
        break;
      case 'monopoly': {
        const state = startMonopoly(room.seats, room.monopolyOptions);
        room.game = { type: 'monopoly', state };
        pushLog(room, {
          t: 'monopolyStart',
          players: seatedPlayers(room).length,
          startCash: room.monopolyOptions.startCash,
        });
        break;
      }
      case 'downstairs': {
        const players = seatedPlayers(room);
        const state = startDownstairs(
          players.map((player) => player.playerId),
          Date.now(),
          Object.fromEntries(players.map((player) => [player.playerId, player.characterId])),
          'pve',
        );
        room.game = { type: 'downstairs', state };
        this.startDownstairsLoop(room);
        break;
      }

      case 'snake': {
        const state = initSnake(room.seats);
        room.game = { type: 'snake', state };
        pushLog(room, { t: 'snakeStart', players: seatedPlayers(room).length });
        this.scheduleSnakeStart(room);
        break;
      }
      case 'minesweeper': {
        const state = dealMinesweeper(room.seats);
        room.game = { type: 'minesweeper', state };
        pushLog(room, { t: 'minesweeperStart', players: seatedPlayers(room).length });
        break;
      }
      case 'dnd': {
        const players = seatedPlayers(room);
        const characterIds = Object.fromEntries(
          players.map((player) => [player.playerId, player.characterId])
        );
        const state = dealDnd(room.seats, characterIds, room.dndDifficulty, bossSeatOf(room));
        room.game = { type: 'dnd', state };
        pushLog(room, { t: 'dndStart', players: seatedPlayers(room).length });
        // 第一棒可能是 NPC（單人魔王模式下整隊都是），先把隊伍跑到該輪到真人／魔王為止
        for (const ev of openingDndTurn(room.seats, state)) pushLog(room, ev);
        break;
      }
      default:
        assertNeverGame(room.gameType);
    }

    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  /** 發德州撲克的下一手：補碼、轉莊、發牌、貼盲注。 */
  private startHoldemHand(room: Room): void {
    if (room.handTimer) {
      clearTimeout(room.handTimer);
      room.handTimer = null;
    }

    for (const playerId of refillChips(room)) {
      pushLog(room, {
        t: 'rebuy',
        player: nicknameOf(room, playerId),
        amount: HOLDEM_START_CHIPS,
      });
    }
    if (fundedCount(room) < SEAT_LIMITS.holdem.min) return;

    const previous = room.game?.type === 'holdem' ? room.game.state : null;
    room.buttonSeat = nextButtonSeat(room.seats, room.chips, room.buttonSeat);
    const state = startHand(room.seats, room.chips, room.buttonSeat, {
      handNo: (previous?.handNo ?? 0) + 1,
    });
    room.game = { type: 'holdem', state };

    const button = room.seats[state.buttonSeat];
    pushLog(room, {
      t: 'holdemStart',
      handNo: state.handNo,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
    });
    if (button) pushLog(room, { t: 'button', player: nicknameOf(room, button) });
  }

  private onPlay(socket: GameSocket, payload: { cardIds?: unknown }, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'bigTwo') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的是德州撲克' } });
    }

    const cardIds = Array.isArray(payload?.cardIds)
      ? payload.cardIds.filter((id): id is string => typeof id === 'string')
      : [];

    const result = playCards(room.seats, game.state, playerId, cardIds);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: PLAY_ERROR_MESSAGE[result.error] },
      });
    }

    pushLog(room, {
      t: 'play',
      player: nicknameOf(room, playerId),
      combo: result.result.combo.type,
      cards: cardIdsOf(result.result.combo.cards),
    });
    if (result.result.rank !== null) {
      pushLog(room, {
        t: 'finished',
        player: nicknameOf(room, playerId),
        rank: result.result.rank,
      });
    }

    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private onPass(socket: GameSocket, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'bigTwo') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的是德州撲克' } });
    }

    const result = passTurn(room.seats, game.state, playerId);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: PLAY_ERROR_MESSAGE[result.error] },
      });
    }

    pushLog(room, { t: 'pass', player: nicknameOf(room, playerId) });
    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private onAction(
    socket: GameSocket,
    payload: { action?: unknown; amount?: unknown },
    ack: unknown,
  ): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'holdem') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的是大老二' } });
    }

    const action = payload?.action as BetAction;
    if (!BET_ACTIONS.includes(action)) {
      return reply(ack, { ok: false, error: { code: 'BAD_ACTION', message: '不支援的動作' } });
    }
    const amount = typeof payload?.amount === 'number' ? Math.floor(payload.amount) : undefined;

    const result = applyBet(room.seats, game.state, playerId, action, amount);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: BET_ERROR_MESSAGE[result.error] },
      });
    }

    pushLog(room, {
      t: 'bet',
      player: nicknameOf(room, playerId),
      action: result.result.seatAction,
    });
    if (result.result.streetAdvanced && !result.result.handOver) {
      pushLog(room, {
        t: 'street',
        street: game.state.street,
        board: cardIdsOf(game.state.board),
      });
    }

    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private onMonopoly(socket: GameSocket, payload: { action?: unknown }, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'monopoly') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的不是大富翁' } });
    }

    const action = parseMonopolyAction(payload?.action);
    if (!action) {
      return reply(ack, { ok: false, error: { code: 'BAD_ACTION', message: '不支援的動作' } });
    }

    const result = applyMonopolyAction(room.seats, game.state, playerId, action);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: MONOPOLY_ERROR_MESSAGE[result.error] },
      });
    }

    this.logMonopoly(room, result.events);
    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }


  private onDownstairs(socket: GameSocket, payload: { direction?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room?.game || room.game.type !== 'downstairs' || room.game.state.over) return;
    if (!room.players.has(session.playerId)) return;
    setDownstairsDirection(room.game.state, session.playerId, Number(payload?.direction));
  }

  private onDownstairsSkill(socket: GameSocket): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room?.game || room.game.type !== 'downstairs' || room.game.state.over) return;
    if (!room.players.has(session.playerId)) return;
    activateDownstairsSkill(room.game.state, session.playerId);
  }

  private startDownstairsLoop(room: Room): void {
    if (room.gameTimer) clearInterval(room.gameTimer);
    let previous = Date.now();
    room.gameTimer = setInterval(() => {
      const game = room.game;
      if (!game || game.type !== 'downstairs') {
        if (room.gameTimer) clearInterval(room.gameTimer);
        room.gameTimer = null;
        return;
      }
      const now = Date.now();
      advanceDownstairs(game.state, now - previous);
      previous = now;
      this.io.to(roomChannel(room.id)).emit('game:downstairsState', downstairsView(game.state));
      if (game.state.over) {
        if (room.gameTimer) clearInterval(room.gameTimer);
        room.gameTimer = null;
        this.checkGameOver(room);
        this.broadcastRoom(room);
        this.broadcastLobby();
      }
    }, DOWNSTAIRS_TICK_MS);
  }

  /**
   * 貪吃蛇專用：只把方向意圖寫進緩衝就回覆，不走 afterGameAction ——
   * 移動、碰撞判定與廣播全部發生在 tick 迴圈，按方向鍵不該立刻重播一次整包快照。
   */
  private onSnake(socket: GameSocket, payload: { dir?: unknown }, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { game, playerId } = context;
    if (game.type !== 'snake') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間不是貪吃蛇' } });
    }

    const dir = SNAKE_DIRECTIONS.find((d) => d === payload?.dir);
    if (!dir) {
      return reply(ack, { ok: false, error: { code: 'BAD_ACTION', message: '不支援的方向' } });
    }

    setSnakeDirection(game.state, playerId, dir);
    reply(ack, { ok: true, data: null });
  }

  private onMinesweeper(socket: GameSocket, payload: { action?: unknown }, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'minesweeper') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的不是踩地雷' } });
    }

    const rawAction = payload?.action as Partial<MinesweeperAction>;
    if (!rawAction || typeof rawAction.r !== 'number' || typeof rawAction.c !== 'number' || (rawAction.kind !== 'reveal' && rawAction.kind !== 'flag' && rawAction.kind !== 'chord')) {
      return reply(ack, { ok: false, error: { code: 'BAD_ACTION', message: '不支援的動作' } });
    }
    const action: MinesweeperAction = {
      kind: rawAction.kind,
      r: Math.floor(rawAction.r),
      c: Math.floor(rawAction.c),
    };

    const result = applyMinesweeperAction(room.seats, game.state, playerId, action);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: MINESWEEPER_ERROR_MESSAGE[result.error] },
      });
    }

    const nickname = nicknameOf(room, playerId);
    if (result.result.kind === 'reveal' || result.result.kind === 'chord') {
      pushLog(room, {
        t: 'minesweeperReveal',
        player: nickname,
        r: result.result.r,
        c: result.result.c,
        points: result.result.points,
      });
    } else {
      pushLog(room, {
        t: 'minesweeperFlag',
        player: nickname,
        r: result.result.r,
        c: result.result.c,
        flagged: result.result.flagged,
      });
    }

    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private onDnd(socket: GameSocket, payload: { action?: unknown }, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'dnd') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的不是龍與地下城' } });
    }

    const rawAction = payload?.action as Partial<DndAction>;
    // 修正這裡：把 rest, skill, turnCombo 放進白名單
    const KINDS = ['move', 'attack', 'moveTo', 'rest', 'skill', 'turnCombo', 'bossMove', 'bossAttack', 'bossHold', 'bossEnd'];
    if (!rawAction || !KINDS.includes(rawAction.kind!)) {
      return reply(ack, { ok: false, error: { code: 'BAD_ACTION', message: '不支援的動作' } });
    }

    const action: DndAction = {
      kind: rawAction.kind as any,
      dir: rawAction.dir,
      targetId: rawAction.targetId,
      r: rawAction.r,
      c: rawAction.c,
      move: rawAction.move,     // 支援組合動作的移動座標
      action: rawAction.action, // 支援組合動作的終結招式
      monsterId: rawAction.monsterId, // 魔王要指揮的那隻怪
    };

    const result = applyDndAction(room.seats, game.state, playerId, action);
    if (!result.ok) {
      // turnCombo 是「先走再打」：移動已經寫進 state 之後，終結招式才可能因為
      // SKILL_ON_COOLDOWN／TARGET_NOT_FOUND 這類理由被擋下來。這時候不重推快照的話，
      // 客戶端會停在移動前的棋盤，跟伺服器一路歪到下一次有人成功行動為止。
      this.broadcastRoom(room);
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: DND_ERROR_MESSAGE[result.error] },
      });
    }

    for (const ev of result.events) {
      pushLog(room, ev);
    }

    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private gameContext(socket: GameSocket, ack: unknown) {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) {
      reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '你不在房間裡' } });
      return null;
    }
    const room = this.rooms.get(session.roomId);
    if (!room?.game || room.game.state.over) {
      reply(ack, { ok: false, error: { code: 'GAME_NOT_RUNNING', message: '遊戲尚未開始' } });
      return null;
    }
    if (!room.players.has(session.playerId)) {
      reply(ack, { ok: false, error: { code: 'SPECTATOR', message: '觀戰者不能出牌' } });
      return null;
    }
    return { room, game: room.game, playerId: session.playerId };
  }

  private afterGameAction(room: Room): void {
    this.checkGameOver(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    this.scheduleTurn(room);
    this.scheduleNextHand(room);
  }

  /**
   * 整局結束時公布名次。
   * 德州撲克是連續的現金局，沒有「整局結束」這回事，只寫攤牌戰報。
   */
  private checkGameOver(room: Room): void {
    const game = room.game;
    if (!game) return;

    switch (game.type) {
      case 'holdem':
        this.logShowdown(room, game.state);
        return;
      case 'bigTwo': {
        if (!game.state.over) return;
        const ranking = game.state.finished;
        if (ranking.length > 0) {
          pushLog(room, { t: 'bigTwoOver', ranking: ranking.map((id) => nicknameOf(room, id)) });
        }
        this.emitRanking(room, ranking);
        return;
      }
      case 'monopoly': {
        if (!game.state.over) return;
        // 結束的那一行戰報由引擎事件帶出來了，這裡只負責公布名次
        this.emitRanking(room, game.state.result?.ranking ?? []);
        return;
      }
      case 'downstairs':
        if (game.state.over) this.emitRanking(room, game.state.ranking);
        return;

      case 'snake': {
        if (!game.state.over) return;
        this.emitRanking(room, game.state.ranking);
        return;
      }
      case 'minesweeper': {
        if (!game.state.over) return;
        const ranking = game.state.ranking;
        if (ranking.length > 0) {
          pushLog(room, { t: 'minesweeperOver', ranking: ranking.map((id) => nicknameOf(room, id)) });
        }
        this.emitRanking(room, ranking);
        return;
      }
      case 'dnd': {
        if (!game.state.over) return;
        const ranking = game.state.ranking;
        this.emitRanking(room, ranking);
        return;
      }
      default:
        assertNeverGame(game);
    }
  }

  /** 大老二與大富翁共用：停掉回合計時，把名次推給房內所有人。 */
  private emitRanking(room: Room, ranking: readonly PlayerId[]): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    this.io.to(roomChannel(room.id)).emit('game:over', {
      ranking: ranking.map((playerId) => ({ playerId, nickname: nicknameOf(room, playerId) })),
    });
  }

  /** 一手結束時寫戰報。同一手只會寫一次。 */
  private logShowdown(room: Room, state: HoldemState): void {
    if (!state.over || !state.showdown) return;
    if (this.loggedHand.get(room.id) === state.handNo) return;
    this.loggedHand.set(room.id, state.handNo);

    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }

    if (state.board.length > 0) pushLog(room, { t: 'board', board: cardIdsOf(state.board) });
    for (const entry of state.showdown) {
      const nickname = nicknameOf(room, entry.playerId);
      if (entry.hand) {
        pushLog(room, {
          t: 'showdown',
          player: nickname,
          category: entry.hand.category,
          tiebreak: entry.hand.tiebreak.slice(),
          won: entry.won,
        });
      } else if (entry.won > 0) {
        pushLog(room, { t: 'uncontested', player: nickname, won: entry.won });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 回合計時
  // -------------------------------------------------------------------------

  private scheduleTurn(room: Room): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }

    const game = room.game;
    if (!game || game.state.over) return;

    if (game.type === 'downstairs') return;

    // 貪吃蛇是即時制，沒有「輪到誰」——回合計時器對它沒有意義，交給 scheduleSnakeTick
    if (game.type === 'snake') return;


    const playerId = room.seats[game.state.turnSeat];
    const player = playerId ? room.players.get(playerId) : undefined;

    // 斷線的人不讓全桌乾等
    if (player && !player.connected) {
      game.state.turnDeadline = Math.min(game.state.turnDeadline, Date.now() + DISCONNECTED_TURN_MS);
    } else if (game.state.turnDeadline < Date.now()) {
      game.state.turnDeadline = Date.now() + TURN_MS;
    }

    const delay = Math.max(0, game.state.turnDeadline - Date.now());
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      this.runAutoAct(room);
    }, delay);
  }

  /**
   * 逾時代打。
   * 代打失敗（引擎回 null）也照樣走 afterGameAction —— 少了它就沒有人重新掛計時器，
   * 房間會永遠停在同一個回合。寧可 45 秒後再試一次，也不要卡死。
   */
  private runAutoAct(room: Room): void {
    const game = room.game;
    if (!game || game.state.over) return;
    if (game.type === 'downstairs') return;

    const playerId = room.seats[game.state.turnSeat];
    const nickname = playerId ? nicknameOf(room, playerId) : '';

    switch (game.type) {
      case 'bigTwo': {
        const acted = autoAct(room.seats, game.state);
        if (acted?.action === 'pass') {
          pushLog(room, { t: 'timeout', player: nickname, auto: 'pass' });
        } else if (acted) {
          pushLog(room, {
            t: 'timeoutPlay',
            player: nickname,
            combo: acted.result.combo.type,
            cards: cardIdsOf(acted.result.combo.cards),
          });
          if (acted.result.rank !== null) {
            pushLog(room, { t: 'finished', player: nickname, rank: acted.result.rank });
          }
        }
        break;
      }
      case 'holdem': {
        const acted = autoActHoldem(room.seats, game.state);
        if (acted) pushLog(room, { t: 'timeout', player: nickname, auto: acted.action });
        break;
      }
      case 'monopoly': {
        const acted = autoActMonopoly(room.seats, game.state);
        if (acted) {
          pushLog(room, { t: 'timeoutMonopoly', player: nickname, phase: acted.phase });
          this.logMonopoly(room, acted.events);
        }
        break;
      }
      case 'snake':
        // scheduleTurn 對貪吃蛇一律提早 return，這裡永遠不會被排到；留著只是為了窮盡檢查
        break;
      case 'minesweeper': {
        const acted = autoActMinesweeper(room.seats, game.state);
        if (acted && acted.ok) {
          pushLog(room, { t: 'timeoutMinesweeper', player: nickname });
          if (acted.result.kind === 'reveal') {
            pushLog(room, {
              t: 'minesweeperReveal',
              player: nickname,
              r: acted.result.r,
              c: acted.result.c,
              points: acted.result.points,
            });
          }
        }
        break;
      }
      case 'dnd': {
        const acted = autoActDnd(room.seats, game.state);
        if (acted && acted.ok) {
          pushLog(room, { t: 'timeoutDnd', player: nickname });
          for (const ev of acted.events) {
            pushLog(room, ev);
          }
        }
        break;
      }
      default:
        assertNeverGame(game);
    }

    this.afterGameAction(room);
  }

  /** 德州撲克：攤牌停留一下，再自動發下一手。 */
  private scheduleNextHand(room: Room): void {
    if (room.handTimer) {
      clearTimeout(room.handTimer);
      room.handTimer = null;
    }

    const game = room.game;
    if (game?.type !== 'holdem' || !game.state.over) return;
    if (seatedPlayers(room).length < SEAT_LIMITS.holdem.min) return;

    room.handTimer = setTimeout(() => {
      room.handTimer = null;
      if (this.rooms.get(room.id) !== room) return; // 房間已經被砍掉了
      this.startHoldemHand(room);
      this.afterGameAction(room);
    }, HOLDEM_SHOWDOWN_MS);
  }

  // -------------------------------------------------------------------------
  // 貪吃蛇：即時 tick 迴圈
  // -------------------------------------------------------------------------

  /**
   * 開局倒數：狀態已經初始化好了（棋盤、出生位置都看得到），但要等 startAt 那一刻
   * 才真的開始跑 tick。這段期間 room.tickTimer 借來扛「倒數結束」這一次性事件，
   * 時間到了才交棒給 scheduleSnakeTick 開始真正的每拍迴圈。
   */
  private scheduleSnakeStart(room: Room): void {
    if (room.tickTimer) {
      clearTimeout(room.tickTimer);
      room.tickTimer = null;
    }

    const game = room.game;
    if (!game || game.type !== 'snake') return;

    const delay = Math.max(0, game.state.startAt - Date.now());
    room.tickTimer = setTimeout(() => {
      room.tickTimer = null;
      this.scheduleSnakeTick(room);
    }, delay);
  }

  /**
   * 排下一拍。跟 scheduleTurn／scheduleNextHand 是平行的第三套計時機制 ——
   * 貪吃蛇沒有回合、也沒有「下一手」，這個迴圈只負責每隔 SNAKE_TICK_MS 推進一次棋盤。
   */
  private scheduleSnakeTick(room: Room): void {
    if (room.tickTimer) {
      clearTimeout(room.tickTimer);
      room.tickTimer = null;
    }

    const game = room.game;
    if (!game || game.type !== 'snake' || game.state.over) return;

    room.tickTimer = setTimeout(() => {
      room.tickTimer = null;
      this.runSnakeTick(room);
    }, SNAKE_TICK_MS);
  }

  private runSnakeTick(room: Room): void {
    if (this.rooms.get(room.id) !== room) return; // 房間已經被砍掉了
    const game = room.game;
    if (!game || game.type !== 'snake' || game.state.over) return;

    this.logSnake(room, tickSnake(game.state));
    // 這裡不走 afterGameAction：它的 scheduleTurn／scheduleNextHand 對貪吃蛇本來就是空操作，
    // 但 broadcastLobby 會每拍重建一次整份大廳快照 —— 而 RoomSummary 只有 status 會變
    this.checkGameOver(room);
    this.broadcastRoom(room);
    if (game.state.over) {
      this.broadcastLobby(); // status 從 playing 變 finished，這一拍才需要更新大廳
      return;
    }
    this.scheduleSnakeTick(room);
  }
}
