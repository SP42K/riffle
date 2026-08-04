import type { Server, Socket } from 'socket.io';
import {
  DISCONNECT_GRACE_MS,
  TURN_MS,
  cardsLabel,
  describeCombo,
  type Ack,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinMode,
  type PlayerId,
  type ServerToClientEvents,
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
  addSpectator,
  buildRoomView,
  buildSummary,
  canStart,
  clampMaxPlayers,
  createRoom,
  generateRoomId,
  isEmpty,
  makeChatMessage,
  makeSystemMessage,
  memberOf,
  modeOf,
  nicknameOf,
  pushChat,
  pushLog,
  removeMember,
  seatPlayer,
  seatedPlayers,
  statusOf,
  type Member,
  type Room,
} from './rooms.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameIo = Server<ClientToServerEvents, ServerToClientEvents>;

const LOBBY = 'lobby';
const roomChannel = (roomId: string) => `room:${roomId}`;

/** 斷線的人輪到時不用等滿 45 秒，短暫等一下就代打。 */
const DISCONNECTED_TURN_MS = 3_000;

interface Session {
  playerId: PlayerId;
  nickname: string;
  roomId: string | null;
}

function cleanText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim().slice(0, max);
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
    socket.on('game:start', (_payload, ack) => this.onStartGame(socket, ack));
    socket.on('game:play', (payload, ack) => this.onPlay(socket, payload, ack));
    socket.on('game:pass', (_payload, ack) => this.onPass(socket, ack));
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

    // 斷線時把回合縮短成 3 秒，回來了要把整個回合還給他，否則一重整就被自動 PASS
    const game = room.game;
    if (game && !game.over && room.seats[game.turnSeat] === playerId) {
      game.turnDeadline = Date.now() + TURN_MS;
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
      this.dropFromRoom(room, session.playerId, '斷線離開');
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

  private systemNotice(room: Room, text: string): void {
    pushChat(room.chat, makeSystemMessage(text));
    this.broadcastRoomChat(room);
  }

  private memberFromSession(session: Session): Member {
    return {
      playerId: session.playerId,
      nickname: session.nickname,
      socketId: null,
      connected: true,
      graceTimer: null,
    };
  }

  private onCreateRoom(
    socket: GameSocket,
    payload: { name?: unknown; maxPlayers?: unknown },
    ack: unknown,
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session) return reply(ack, { ok: false, error: { code: 'BAD_SESSION', message: '請先連線' } });
    if (session.roomId) {
      return reply(ack, { ok: false, error: { code: 'ALREADY_IN_ROOM', message: '你已經在房間裡' } });
    }

    const name = cleanText(payload?.name, 20) || `${session.nickname} 的房間`;
    const maxPlayers = clampMaxPlayers(payload?.maxPlayers);
    const id = generateRoomId((candidate) => this.rooms.has(candidate));

    const host = this.memberFromSession(session);
    host.socketId = socket.id;
    const room = createRoom(id, name, maxPlayers, host);
    this.rooms.set(id, room);

    session.roomId = id;
    this.playerRoom.set(session.playerId, id);
    socket.leave(LOBBY);
    socket.join(roomChannel(id));

    this.systemNotice(room, `${session.nickname} 建立了房間`);
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
      if (room.seats.every((seat) => seat !== null)) {
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
      if (room.game && !room.game.over) removePlayerFromGame(room.seats, room.game, session.playerId);
      addSpectator(room, member);
    }

    session.roomId = roomId;
    this.playerRoom.set(session.playerId, roomId);
    socket.leave(LOBBY);
    socket.join(roomChannel(roomId));

    socket.emit('room:chat', { messages: room.chat });
    this.systemNotice(room, `${session.nickname} ${mode === 'play' ? '加入了房間' : '進來觀戰'}`);
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
    if (room) this.dropFromRoom(room, session.playerId, '離開了房間');
  }

  /** 把玩家徹底移出房間（主動離開或斷線寬限到期）。 */
  private dropFromRoom(room: Room, playerId: PlayerId, reason: string): void {
    if (!modeOf(room, playerId)) return;
    const nickname = nicknameOf(room, playerId);

    if (room.game && !room.game.over && room.players.has(playerId)) {
      removePlayerFromGame(room.seats, room.game, playerId);
    }
    removeMember(room, playerId);
    this.playerRoom.delete(playerId);

    if (isEmpty(room)) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      this.rooms.delete(room.id);
      this.broadcastLobby();
      return;
    }

    this.systemNotice(room, `${nickname} ${reason}`);
    this.checkGameOver(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    this.scheduleTurn(room);
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
      return reply(ack, {
        ok: false,
        error: { code: 'NOT_READY', message: '需要至少 2 位玩家，且所有人都按下準備' },
      });
    }

    room.game = dealGame(room.seats);
    room.log = [];
    for (const player of room.players.values()) player.ready = false;

    const leader = room.seats[room.game.turnSeat];
    pushLog(room, `新的一局開始，共 ${seatedPlayers(room).length} 人`);
    if (leader) pushLog(room, `${nicknameOf(room, leader)} 持有最小的牌，先手`);

    this.broadcastRoom(room);
    this.broadcastLobby();
    this.scheduleTurn(room);
    reply(ack, { ok: true, data: null });
  }

  private onPlay(socket: GameSocket, payload: { cardIds?: unknown }, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;

    const cardIds = Array.isArray(payload?.cardIds)
      ? payload.cardIds.filter((id): id is string => typeof id === 'string')
      : [];

    const result = playCards(room.seats, game, playerId, cardIds);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: PLAY_ERROR_MESSAGE[result.error] },
      });
    }

    pushLog(room, `${nicknameOf(room, playerId)} 出 ${describeCombo(result.result.combo)}`);
    if (result.result.rank !== null) {
      pushLog(room, `${nicknameOf(room, playerId)} 出完了，第 ${result.result.rank} 名`);
    }

    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private onPass(socket: GameSocket, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;

    const result = passTurn(room.seats, game, playerId);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: PLAY_ERROR_MESSAGE[result.error] },
      });
    }

    pushLog(room, `${nicknameOf(room, playerId)} PASS`);
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
    if (!room?.game || room.game.over) {
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
  }

  private checkGameOver(room: Room): void {
    const game = room.game;
    if (!game?.over) return;
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }

    const ranking = game.finished.map((playerId) => ({
      playerId,
      nickname: nicknameOf(room, playerId),
    }));
    const podium = ranking.map((entry, index) => `第 ${index + 1} 名 ${entry.nickname}`).join('、');
    if (podium) pushLog(room, `本局結束：${podium}`);

    this.io.to(roomChannel(room.id)).emit('game:over', { ranking });
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
    if (!game || game.over) return;

    const playerId = room.seats[game.turnSeat];
    const player = playerId ? room.players.get(playerId) : undefined;

    // 斷線的人不讓全桌乾等
    if (player && !player.connected) {
      game.turnDeadline = Math.min(game.turnDeadline, Date.now() + DISCONNECTED_TURN_MS);
    } else if (game.turnDeadline < Date.now()) {
      game.turnDeadline = Date.now() + TURN_MS;
    }

    const delay = Math.max(0, game.turnDeadline - Date.now());
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      this.runAutoAct(room);
    }, delay);
  }

  private runAutoAct(room: Room): void {
    const game = room.game;
    if (!game || game.over) return;

    const playerId = room.seats[game.turnSeat];
    const nickname = playerId ? nicknameOf(room, playerId) : '';
    const acted = autoAct(room.seats, game);
    if (!acted) return;

    if (acted.action === 'pass') {
      pushLog(room, `${nickname} 逾時，自動 PASS`);
    } else {
      pushLog(room, `${nickname} 逾時，自動出 ${describeCombo(acted.result.combo)}`);
      if (acted.result.rank !== null) {
        pushLog(room, `${nickname} 出完了，第 ${acted.result.rank} 名`);
      }
    }

    this.afterGameAction(room);
  }
}

export { cardsLabel };
