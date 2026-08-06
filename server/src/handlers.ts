import type { Server, Socket } from 'socket.io';
import {
  DISCONNECT_GRACE_MS,
  HOLDEM_SHOWDOWN_MS,
  HOLDEM_START_CHIPS,
  SEAT_LIMITS,
  TURN_MS,
  type Ack,
  type BetAction,
  type Card,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinMode,
  type PlayerId,
  type ServerToClientEvents,
  type SystemNotice,
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
  BET_ERROR_MESSAGE,
  applyBet,
  autoActHoldem,
  nextButtonSeat,
  removePlayerFromHoldem,
  startHand,
  type HoldemState,
} from './holdemEngine.js';
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
  nicknameOf,
  normalizeBigTwoRules,
  normalizeGameType,
  pushChat,
  pushLog,
  refillChips,
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
    socket.on('game:start', (_payload, ack) => this.onStartGame(socket, ack));
    socket.on('game:play', (payload, ack) => this.onPlay(socket, payload, ack));
    socket.on('game:pass', (_payload, ack) => this.onPass(socket, ack));
    socket.on('game:action', (payload, ack) => this.onAction(socket, payload, ack));
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
    if (game && !game.state.over && room.seats[game.state.turnSeat] === playerId) {
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
    };
  }

  private onCreateRoom(
    socket: GameSocket,
    payload: { name?: unknown; maxPlayers?: unknown; gameType?: unknown; bigTwoRules?: unknown },
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
    const id = generateRoomId((candidate) => this.rooms.has(candidate));

    const host = this.memberFromSession(session);
    host.socketId = socket.id;
    const room = createRoom(id, name, gameType, maxPlayers, bigTwoRules, host);
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
      this.rooms.delete(room.id);
      this.loggedHand.delete(room.id);
      this.broadcastLobby();
      return;
    }

    this.systemNotice(room, { t: reason, player: nickname });
    this.afterGameAction(room);
  }

  /** 讓玩家從進行中的牌局退出：大老二是抽掉手牌，德州撲克是視同蓋牌。 */
  private removeFromGame(room: Room, playerId: PlayerId): void {
    const game = room.game;
    if (!game || game.state.over) return;
    if (game.type === 'bigTwo') removePlayerFromGame(room.seats, game.state, playerId);
    else removePlayerFromHoldem(room.seats, game.state, playerId);
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
      const min = SEAT_LIMITS[room.gameType].min;
      return reply(ack, {
        ok: false,
        error: { code: 'NOT_READY', message: `需要至少 ${min} 位玩家，且所有人都按下準備` },
      });
    }

    room.log = [];
    for (const player of room.players.values()) player.ready = false;

    if (room.gameType === 'bigTwo') {
      const state = dealGame(room.seats, room.bigTwoRules);
      room.game = { type: 'bigTwo', state };
      pushLog(room, { t: 'bigTwoStart', players: seatedPlayers(room).length });
      const leader = room.seats[state.turnSeat];
      if (leader) pushLog(room, { t: 'lead', player: nicknameOf(room, leader) });
    } else {
      this.startHoldemHand(room);
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

  /** 大老二整局結束時公布名次。德州撲克是連續的現金局，不走這條路。 */
  private checkGameOver(room: Room): void {
    const game = room.game;
    if (!game) return;

    if (game.type === 'holdem') {
      this.logShowdown(room, game.state);
      return;
    }
    if (!game.state.over) return;

    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }

    const ranking = game.state.finished.map((playerId) => ({
      playerId,
      nickname: nicknameOf(room, playerId),
    }));
    if (ranking.length > 0) {
      pushLog(room, { t: 'bigTwoOver', ranking: ranking.map((entry) => entry.nickname) });
    }

    this.io.to(roomChannel(room.id)).emit('game:over', { ranking });
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

  private runAutoAct(room: Room): void {
    const game = room.game;
    if (!game || game.state.over) return;

    const playerId = room.seats[game.state.turnSeat];
    const nickname = playerId ? nicknameOf(room, playerId) : '';

    if (game.type === 'bigTwo') {
      const acted = autoAct(room.seats, game.state);
      if (!acted) return;

      if (acted.action === 'pass') {
        pushLog(room, { t: 'timeout', player: nickname, auto: 'pass' });
      } else {
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
    } else {
      const acted = autoActHoldem(room.seats, game.state);
      if (!acted) return;
      pushLog(room, { t: 'timeout', player: nickname, auto: acted.action });
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
}
