import type { Server, Socket } from 'socket.io';
import {
  DISCONNECT_GRACE_MS,
  HOLDEM_SHOWDOWN_MS,
  HOLDEM_START_CHIPS,
  MAHJONG_ACTION_KINDS,
  MONOPOLY_ACTION_KINDS,
  MONOPOLY_ESTATE_IDS,
  SEAT_LIMITS,
  SNAKE_DIRECTIONS,
  SNAKE_GRID_SIZE,
  SNAKE_LARGE_MAP_SCALE,
  SNAKE_TICK_MS,
  TURN_MS,
  type Ack,
  type BetAction,
  type Card,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinMode,
  type MahjongAction,
  type MahjongReactionAction,
  type MahjongRoundResult,
  type MahjongSelfDrawAction,
  type MahjongTileId,
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
import { aiChooseDiscard, aiRespond, aiSelfDrawAction } from './mahjongAi.js';
import {
  MAHJONG_ERROR_MESSAGE,
  allMahjongRoundReady,
  autoActMahjong,
  chooseSelfDrawAction,
  confirmMahjongRoundReady,
  continueMahjongRound,
  discardTile,
  finalizeMahjongMatch,
  rankMahjongSeats,
  respondToReaction,
  startMahjong,
  type MahjongError,
  type MahjongState,
} from './mahjongEngine.js';
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
  fillMahjongNpcSeats,
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
  normalizeDndNpcControl,
  npcControllerOf,
  normalizeMonopolyOptions,
  normalizeSnakeOptions,
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
  useSnakeDash,
  useSnakeItem,
  type SnakeEvent,
} from './snakeEngine.js';
import { assertNeverGame } from './turnBased.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameIo = Server<ClientToServerEvents, ServerToClientEvents>;

const LOBBY = 'lobby';
const roomChannel = (roomId: string) => `room:${roomId}`;

/** 斷線的人輪到時不用等滿 45 秒，短暫等一下就代打。 */
const DISCONNECTED_TURN_MS = 3_000;

/** 台灣麻將一局結束後，等大家在結算畫面按繼續；超過這個時間還沒按齊也會直接開下一局，不會踢人。 */
const MAHJONG_ROUND_READY_MS = 3 * 60_000;

/**
 * 台灣麻將打完最後一局（pendingMatchEnd）後，結算畫面（胡牌牌型／台數）固定顯示這麼久，
 * 不用等玩家按繼續——反正沒有下一局可以繼續，時間到就自動轉成整場比賽結束畫面。
 */
const MAHJONG_MATCH_END_DELAY_MS = 20_000;

/** 電腦座位出手前的固定延遲。真人的思考時間在 mahjongEngine.ts 另外給 1 分鐘。 */
const MAHJONG_NPC_DELAY_MS = 1_800;

/**
 * 開局擲骰動畫的總長度，要跟 MahjongTable.tsx 的 dealPhase 時間軸（擲骰 3s、蓋牌 3s、
 * 翻牌 1.5s，滿 7.5s 才顯示「遊戲開始」）對齊——不然電腦座位可能在畫面還在擲骰、蓋牌時
 * 就搶先出手，等動畫播完畫面一翻牌，牌局其實已經跑掉好幾步了。多留 0.75 秒緩衝，
 * 讓玩家看完「遊戲開始」的字樣再開始動作，不會一翻牌電腦就立刻打牌。
 */
const MAHJONG_DEAL_MS = 7_500 + 750;

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

/**
 * 把來路不明的 payload 收成 MahjongAction。
 * 認不得的 kind、缺欄位 —— 一律回 null，由呼叫端吐 BAD_ACTION。
 */
function parseMahjongAction(value: unknown): MahjongAction | null {
  const input = (value ?? {}) as { kind?: unknown };
  const kind = MAHJONG_ACTION_KINDS.find((k) => k === input.kind);
  if (!kind) return null;

  switch (kind) {
    case 'discard': {
      const tile = (input as { tile?: unknown }).tile;
      return typeof tile === 'string' && tile ? { kind, tile } : null;
    }
    case 'selfDraw': {
      const raw = input as { action?: unknown; tile?: unknown };
      const action = raw.action as MahjongSelfDrawAction;
      if (action !== 'hu' && action !== 'gang' && action !== 'none') return null;
      const tile = typeof raw.tile === 'string' ? raw.tile : undefined;
      return { kind, action, tile };
    }
    case 'respond': {
      const raw = input as { action?: unknown; chiTiles?: unknown };
      const action = raw.action as MahjongReactionAction;
      if (action !== 'hu' && action !== 'peng' && action !== 'gang' && action !== 'chi' && action !== 'pass') {
        return null;
      }
      let chiTiles: [MahjongTileId, MahjongTileId] | undefined;
      const rawChi = raw.chiTiles;
      if (Array.isArray(rawChi) && rawChi.length === 2 && typeof rawChi[0] === 'string' && typeof rawChi[1] === 'string') {
        chiTiles = [rawChi[0], rawChi[1]];
      }
      return { kind, action, chiTiles };
    }
    case 'continueRound':
      return { kind };
  }
}

/**
 * 每個座位目前手上的槓（暗槓／加槓／明槓皆算）用到的牌，供 gangLogDiff 比對用。
 * 加槓是把既有的碰 meld 原地改成槓（tiles/type 變了，陣列長度不變），暗槓則是整組新增，
 * 兩種都要能抓到，所以比對的是「每家有哪些槓用的牌」而不是 meld 陣列長度。
 */
function gangTileSnapshot(state: MahjongState): MahjongTileId[][] {
  return state.players.map((p) => p.melds.filter((m) => m.type === 'gang').map((m) => m.tiles[0]!));
}

/**
 * 自摸階段宣告暗槓／加槓，跟反應階段有人放棄搶槓後補完的加槓，都不會經過
 * respondToReaction 裡「明槓」那個既有的 pushLog 分支（那支只認「吃碰別人棄牌」），
 * 所以用動作前後的槓牌快照比對，抓出這次呼叫新完成的槓，逐一補上戰報。
 */
function pushMahjongGangLogs(room: Room, before: MahjongTileId[][], state: MahjongState): void {
  state.players.forEach((player, seat) => {
    const remaining = [...before[seat]!];
    for (const meld of player.melds) {
      if (meld.type !== 'gang') continue;
      const tile = meld.tiles[0]!;
      const idx = remaining.indexOf(tile);
      if (idx !== -1) {
        remaining.splice(idx, 1);
        continue;
      }
      const gangPlayerId = room.seats[seat];
      if (gangPlayerId) {
        pushLog(room, { t: 'mahjongMeld', player: nicknameOf(room, gangPlayerId), kind: 'gang', tiles: [tile] });
      }
    }
  });
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
    socket.on('game:snakeItem', (_payload, ack) => this.onSnakeItem(socket, ack));
    socket.on('game:snakeDash', (_payload, ack) => this.onSnakeDash(socket, ack));
    socket.on('game:minesweeper', (payload, ack) => this.onMinesweeper(socket, payload, ack));
    socket.on('game:dnd', (payload, ack) => this.onDnd(socket, payload, ack));
    socket.on('room:dndDifficulty', (payload) => this.onDndDifficulty(socket, payload));
    socket.on('room:dndRole', (payload) => this.onDndRole(socket, payload));
    socket.on('room:dndNpcControl', (payload) => this.onDndNpcControl(socket, payload));
    socket.on('game:mahjong', (payload, ack) => this.onMahjong(socket, payload, ack));
    socket.on('room:addNpc', (_payload, ack) => this.onAddNpc(socket, ack));
    socket.on('room:requestJoin', (payload, ack) => this.onMahjongRequestJoin(socket, payload, ack));
    socket.on('room:respondJoinRequest', (payload, ack) => this.onMahjongRespondJoinRequest(socket, payload, ack));
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
      snakeOptions?: unknown;
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
    const snakeOptions = normalizeSnakeOptions(payload?.snakeOptions);
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
      snakeOptions,
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
      if (room.npcTimer) clearTimeout(room.npcTimer);
      this.rooms.delete(room.id);
      this.loggedHand.delete(room.id);
      this.broadcastLobby();
      return;
    }

    // 麻將牌局進行到一半有人離開，座位空出來後馬上補電腦代打，牌局不中斷、不判整場比賽結束。
    const game = room.game;
    if (room.gameType === 'taiwanMahjong' && game?.type === 'taiwanMahjong' && !game.state.matchOver) {
      fillMahjongNpcSeats(room);
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
      case 'taiwanMahjong':
        // 麻將座位一走，dropFromRoom 會在座位真的空出來後補電腦代打接手，牌局不中斷——
        // 不像其他玩法要在這裡動引擎狀態，麻將什麼都不用做，等電腦補位就好。
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

  /** NPC 隊友要不要由房主親自操作，也是房主的決定，只能在開局前改。 */
  private onDndNpcControl(socket: GameSocket, payload: { control?: unknown }): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room || room.gameType !== 'dnd') return;
    if (room.hostId !== session.playerId || statusOf(room) === 'playing') return;

    room.dndNpcControl = normalizeDndNpcControl(payload?.control);
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

  /** 房主把台灣麻將房間剩下的空位一次補滿電腦玩家，方便自己一個人也能整桌測試。 */
  private onAddNpc(socket: GameSocket, ack: unknown): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '你不在房間裡' } });
    const room = this.rooms.get(session.roomId);
    if (!room) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '找不到房間' } });
    if (room.hostId !== session.playerId) {
      return reply(ack, { ok: false, error: { code: 'NOT_HOST', message: '只有房主可以補電腦玩家' } });
    }
    if (room.gameType !== 'taiwanMahjong') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個玩法不支援電腦玩家' } });
    }
    if (statusOf(room) === 'playing') {
      return reply(ack, { ok: false, error: { code: 'IN_PROGRESS', message: '這局還在進行中' } });
    }

    const added = fillMahjongNpcSeats(room);
    if (added > 0) this.systemNotice(room, { t: 'joined', player: `${added} 位電腦玩家` });
    this.broadcastRoom(room);
    this.broadcastLobby();
    reply(ack, { ok: true, data: null });
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
        const scale = room.snakeOptions.largeMap ? SNAKE_LARGE_MAP_SCALE : 1;
        const size = SNAKE_GRID_SIZE * scale;
        const state = initSnake(room.seats, Math.random, size, size, room.snakeOptions);
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
        const state = dealDnd(
          room.seats,
          characterIds,
          room.dndDifficulty,
          bossSeatOf(room),
          npcControllerOf(room),
        );
        room.game = { type: 'dnd', state };
        pushLog(room, { t: 'dndStart', players: seatedPlayers(room).length });
        // 第一棒可能是 NPC（單人魔王模式下整隊都是），先把隊伍跑到該輪到真人／魔王為止
        for (const ev of openingDndTurn(room.seats, state)) pushLog(room, ev);
        break;
      }
      case 'taiwanMahjong': {
        const state = startMahjong(room.seats);
        room.game = { type: 'taiwanMahjong', state };
        room.mahjongDealUntil = Date.now() + MAHJONG_DEAL_MS;
        pushLog(room, { t: 'mahjongStart', players: seatedPlayers(room).length });
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

  /**
   * 空白鍵：用掉道具欄第一格。跟按方向鍵不同——這個有立即可見的效果（子彈開槍、狀態生效），
   * 要走 afterGameAction 整包廣播出去；「會提醒大家」的道具（SNAKE_ITEM_CONFIG.announce）
   * 額外發一則聊天室系統通知，比戰報那六行更顯眼。
   */
  private onSnakeItem(socket: GameSocket, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'snake') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間不是貪吃蛇' } });
    }

    const events = useSnakeItem(game.state, playerId, Math.random);
    this.logSnake(room, events);
    for (const event of events) {
      if (event.t === 'item') {
        this.systemNotice(room, { t: 'snakeItem', player: nicknameOf(room, event.player), item: event.item });
      }
    }
    this.afterGameAction(room);
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

  /**
   * X 鍵：觸發衝刺截斷技能。沒開 cutting 選項、還在冷卻、或已經在充能/衝刺中，引擎會回空陣列，
   * 這裡就當作無事發生（不報錯，跟按空白鍵但道具欄是空的一樣靜默忽略）。
   * 充能開始一定要公告，讓其他人有機會閃避——跟道具系統的 announce 邏輯一致。
   */
  private onSnakeDash(socket: GameSocket, ack: unknown): void {
    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'snake') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間不是貪吃蛇' } });
    }

    const events = useSnakeDash(game.state, playerId);
    this.logSnake(room, events);
    for (const event of events) {
      if (event.t === 'dash') {
        this.systemNotice(room, { t: 'snakeDash', player: nicknameOf(room, event.player) });
      }
    }
    this.afterGameAction(room);
    reply(ack, { ok: true, data: null });
  }

  private onMahjong(socket: GameSocket, payload: { action?: unknown }, ack: unknown): void {
    const action = parseMahjongAction(payload?.action);
    if (!action) {
      return reply(ack, { ok: false, error: { code: 'BAD_ACTION', message: '不支援的動作' } });
    }

    // 結算畫面按繼續：這時 state.over 是 true，會被 gameContext 擋掉，所以另外走一條路。
    if (action.kind === 'continueRound') {
      this.onMahjongContinueRound(socket, ack);
      return;
    }

    const context = this.gameContext(socket, ack);
    if (!context) return;
    const { room, game, playerId } = context;
    if (game.type !== 'taiwanMahjong') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '這個房間玩的不是台灣麻將' } });
    }

    const before = game.state.roundResult;
    let result: { ok: true } | { ok: false; error: MahjongError };
    switch (action.kind) {
      case 'discard':
        result = discardTile(room.seats, game.state, playerId, action.tile);
        if (result.ok) {
          pushLog(room, { t: 'mahjongDiscard', player: nicknameOf(room, playerId), tile: action.tile });
        }
        break;
      case 'selfDraw': {
        const gangsBefore = gangTileSnapshot(game.state);
        result = chooseSelfDrawAction(room.seats, game.state, playerId, action.action, action.tile);
        if (result.ok) pushMahjongGangLogs(room, gangsBefore, game.state);
        break;
      }
      case 'respond': {
        // 戰報要記的是實際被吃／碰／槓掉的那張棄牌，不是手上湊組合用的那兩張——
        // 這張要在呼叫 respondToReaction 之前先拿，因為成功後 reaction 就被引擎清掉了。
        const eatenTile = game.state.reaction?.discardedTile;
        const gangsBefore = gangTileSnapshot(game.state);
        result = respondToReaction(room.seats, game.state, playerId, action.action, action.chiTiles);
        if (result.ok && action.action !== 'pass' && action.action !== 'hu' && eatenTile) {
          pushLog(room, {
            t: 'mahjongMeld',
            player: nicknameOf(room, playerId),
            kind: action.action,
            tiles: [eatenTile],
          });
        } else if (result.ok && action.action === 'pass') {
          // PASS 有可能是放棄搶槓，讓別人剛剛宣告的加槓補完——那組槓要記在「加槓的人」身上，
          // 不是這個按 PASS 的人，所以不能用 playerId，得靠槓牌快照比對抓出真正補完的座位。
          pushMahjongGangLogs(room, gangsBefore, game.state);
        }
        break;
      }
    }

    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: MAHJONG_ERROR_MESSAGE[result.error] },
      });
    }

    this.logMahjongRoundEnd(room, game.state, before);
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

  /**
   * 結算畫面按「繼續」。這時 game.state.over 一定是 true，所以不能走 gameContext（會被擋掉），
   * 另外自己找房間跟座位。全部座位都按過才馬上開下一局，不然就先廣播讓大家看到目前確認進度，
   * 等 scheduleNextMahjongRound 排的 20 秒逾時計時器自然到期。
   */
  private onMahjongContinueRound(socket: GameSocket, ack: unknown): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) {
      return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '你不在房間裡' } });
    }
    const room = this.rooms.get(session.roomId);
    const game = room?.game;
    if (!room || !game || game.type !== 'taiwanMahjong') {
      return reply(ack, { ok: false, error: { code: 'GAME_NOT_RUNNING', message: '遊戲尚未開始' } });
    }
    if (!room.players.has(session.playerId)) {
      return reply(ack, { ok: false, error: { code: 'SPECTATOR', message: '觀戰者不能操作' } });
    }
    // 最後一局的結算畫面沒有下一局可以繼續，不接受這個動作——client 也不會顯示按鈕，
    // 這裡只是防呆，避免萬一還是收到這個事件而多開出一局。
    if (game.state.pendingMatchEnd) {
      return reply(ack, { ok: false, error: { code: 'WRONG_PHASE', message: MAHJONG_ERROR_MESSAGE.WRONG_PHASE } });
    }

    const result = confirmMahjongRoundReady(room.seats, game.state, session.playerId);
    if (!result.ok) {
      return reply(ack, {
        ok: false,
        error: { code: result.error, message: MAHJONG_ERROR_MESSAGE[result.error] },
      });
    }

    if (allMahjongRoundReady(room.seats, game.state)) {
      this.advanceMahjongRound(room, game.state);
    } else {
      this.broadcastRoom(room);
    }
    reply(ack, { ok: true, data: null });
  }

  /** 一局結束（贏牌／流局）或整場比賽結束時寫戰報，只在真的產生新結果時才寫。 */
  private logMahjongRoundEnd(room: Room, state: MahjongState, before: MahjongRoundResult | null): void {
    const result = state.roundResult;
    if (!result || result === before) return;

    if (result.winType === 'draw') {
      pushLog(room, { t: 'mahjongDraw' });
    } else if (result.winnerSeat !== null) {
      const winnerId = room.seats[result.winnerSeat];
      if (winnerId) {
        // 放槍者：discard 胡的賠付只有一家出全額，找那個負數座位就是點炮的人；
        // 自摸是三家均攤都是負數，不會湊巧只有一個，所以只有 discard 才會找到人。
        let from: string | undefined;
        if (result.winType === 'discard') {
          const payerSeat = result.payments.findIndex((amount) => amount < 0);
          const payerId = payerSeat !== -1 ? room.seats[payerSeat] : null;
          if (payerId) from = nicknameOf(room, payerId);
        }
        pushLog(room, {
          t: 'mahjongWin',
          player: nicknameOf(room, winnerId),
          winType: result.winType,
          tai: result.tai,
          from,
        });
      }
    }

    if (state.matchOver) {
      const ranking = rankMahjongSeats(state)
        .map((seat) => room.seats[seat])
        .filter((id): id is PlayerId => !!id);
      pushLog(room, { t: 'mahjongOver', ranking: ranking.map((id) => nicknameOf(room, id)) });
    }
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
    this.scheduleNextMahjongRound(room);
    this.scheduleMahjongNpc(room);
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
      case 'taiwanMahjong': {
        // state.over 每一局結束都會短暫為 true（比照德州撲克的 hand-over），
        // 只有 matchOver（達到 20000 分或有人中途離開）才是真正的終局
        if (!game.state.matchOver) return;
        const ranking = rankMahjongSeats(game.state)
          .map((seat) => room.seats[seat])
          .filter((id): id is PlayerId => !!id);
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
      case 'taiwanMahjong': {
        const before = game.state.roundResult;
        const acted = autoActMahjong(game.state);
        if (acted) pushLog(room, { t: 'timeoutMahjong', player: nickname });
        this.logMahjongRoundEnd(room, game.state, before);
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

  /**
   * 台灣麻將：一局結束（state.over）但整場比賽還沒結束（!matchOver）時，停在結算畫面。
   *
   * 如果這局是 pendingMatchEnd（分數已達門檻或局數已打滿），結算畫面沒有「下一局」可以
   * 繼續，就不等玩家按繼續了，固定顯示 MAHJONG_MATCH_END_DELAY_MS 之後直接收尾成整場
   * 比賽結束畫面——胡牌牌型／台數還是完整秀過一輪，只是不需要玩家確認。
   *
   * 不然（還有下一局）就照原本的方式：電腦座位自動視為已按，全部按完就馬上開下一局；
   * 逾時 MAHJONG_ROUND_READY_MS 還沒按也不會把人踢出房間，直接照樣開下一局，
   * 真人這局就跟著留在原位繼續打，只是少按了一次確認。
   */
  private scheduleNextMahjongRound(room: Room): void {
    if (room.handTimer) {
      clearTimeout(room.handTimer);
      room.handTimer = null;
    }

    const game = room.game;
    if (game?.type !== 'taiwanMahjong' || !game.state.over || game.state.matchOver) return;
    if (game.state.phase !== 'roundEnd') return;

    if (game.state.pendingMatchEnd) {
      room.handTimer = setTimeout(() => {
        room.handTimer = null;
        if (this.rooms.get(room.id) !== room) return; // 房間已經被砍掉了
        if (room.game !== game) return; // 這一局已經被別的事件換掉了
        this.finalizeMahjongMatchEnd(room, game.state);
      }, MAHJONG_MATCH_END_DELAY_MS);
      return;
    }

    this.autoConfirmMahjongNpcSeats(room, game.state);
    if (allMahjongRoundReady(room.seats, game.state)) {
      this.advanceMahjongRound(room, game.state);
      return;
    }

    room.handTimer = setTimeout(() => {
      room.handTimer = null;
      if (this.rooms.get(room.id) !== room) return; // 房間已經被砍掉了
      if (room.game !== game) return; // 這一局已經被別的事件換掉了
      this.advanceMahjongRound(room, game.state);
    }, MAHJONG_ROUND_READY_MS);
  }

  /** 真的推進到下一局：清掉等待計時器、重置局面、寫戰報、廣播。 */
  private advanceMahjongRound(room: Room, state: MahjongState): void {
    if (room.handTimer) {
      clearTimeout(room.handTimer);
      room.handTimer = null;
    }
    continueMahjongRound(state);
    const bankerId = room.seats[state.bankerSeat];
    if (bankerId) {
      pushLog(room, { t: 'mahjongRound', round: state.round, banker: nicknameOf(room, bankerId) });
    }
    this.afterGameAction(room);
  }

  /** 結算畫面顯示夠久了：真正把整場比賽收尾，afterGameAction 會接著推名次、停計時器。 */
  private finalizeMahjongMatchEnd(room: Room, state: MahjongState): void {
    if (room.handTimer) {
      clearTimeout(room.handTimer);
      room.handTimer = null;
    }
    finalizeMahjongMatch(state);
    this.afterGameAction(room);
  }

  /** 結算畫面的電腦座位不用真的等它「思考」，直接視為已按繼續。 */
  private autoConfirmMahjongNpcSeats(room: Room, state: MahjongState): void {
    for (let seat = 0; seat < 4; seat++) {
      if (state.roundReady[seat]) continue;
      const playerId = room.seats[seat];
      const member = playerId ? room.players.get(playerId) : undefined;
      if (member?.isNpc) state.roundReady[seat] = true;
    }
  }

  /**
   * 大廳裡有人申請加入這個已經滿位、但還有電腦座位的麻將房間，記下申請，
   * 等房主用 room:respondJoinRequest 接受或婉拒——同時只留最新一筆申請。
   */
  private onMahjongRequestJoin(
    socket: GameSocket,
    payload: { roomId?: unknown },
    ack: unknown,
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session) return reply(ack, { ok: false, error: { code: 'BAD_SESSION', message: '請先連線' } });

    const roomId = cleanText(payload?.roomId, 16).toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '找不到這個房間' } });
    if (room.gameType !== 'taiwanMahjong') {
      return reply(ack, { ok: false, error: { code: 'WRONG_GAME', message: '只有台灣麻將房支援申請加入' } });
    }
    const isFull = room.seats.every((id) => id !== null);
    const hasNpcSeat = room.seats.some((id) => (id ? room.players.get(id)?.isNpc : false));
    if (!isFull || !hasNpcSeat) {
      return reply(ack, { ok: false, error: { code: 'NO_NPC_SEAT', message: '這個房間沒有電腦座位可以頂替' } });
    }

    room.mahjongJoinRequest = { playerId: session.playerId, nickname: session.nickname, socketId: socket.id };
    this.broadcastRoom(room);
    reply(ack, { ok: true, data: null });
  }

  /** 房主接受或婉拒目前待處理的加入申請。 */
  private onMahjongRespondJoinRequest(
    socket: GameSocket,
    payload: { accept?: unknown },
    ack: unknown,
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session?.roomId) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '你不在房間裡' } });
    const room = this.rooms.get(session.roomId);
    if (!room) return reply(ack, { ok: false, error: { code: 'NO_ROOM', message: '找不到這個房間' } });
    if (room.hostId !== session.playerId) {
      return reply(ack, { ok: false, error: { code: 'NOT_HOST', message: '只有房主能處理加入申請' } });
    }
    const request = room.mahjongJoinRequest;
    if (!request) return reply(ack, { ok: false, error: { code: 'NO_REQUEST', message: '目前沒有待處理的申請' } });
    room.mahjongJoinRequest = null;

    const accept = payload?.accept === true;
    const requesterSocket = this.io.sockets.sockets.get(request.socketId);
    const requesterSession = requesterSocket ? this.sessions.get(requesterSocket.id) : undefined;
    const stillWaiting = Boolean(requesterSession && requesterSession.playerId === request.playerId);

    const npcSeat = room.seats.findIndex((id) => (id ? room.players.get(id)?.isNpc : false));

    if (!accept || !stillWaiting || npcSeat === -1) {
      if (stillWaiting && requesterSocket) {
        requesterSocket.emit('error', {
          code: !accept ? 'JOIN_REJECTED' : 'NO_NPC_SEAT',
          message: !accept ? '房主婉拒了你的加入申請' : '座位已經被別人補走了',
        });
      }
      this.broadcastRoom(room);
      reply(ack, { ok: true, data: null });
      return;
    }

    const npcId = room.seats[npcSeat]!;
    removeMember(room, npcId);

    const member: Member = {
      playerId: request.playerId,
      nickname: request.nickname,
      socketId: requesterSocket!.id,
      connected: true,
      graceTimer: null,
      characterId: 'brave',
      dndRole: 'hero',
    };
    seatPlayer(room, member);
    requesterSession!.roomId = room.id;
    this.playerRoom.set(request.playerId, room.id);
    requesterSocket!.leave(LOBBY);
    requesterSocket!.join(roomChannel(room.id));
    requesterSocket!.emit('room:chat', { messages: room.chat });
    this.systemNotice(room, { t: 'joined', player: request.nickname });

    this.broadcastRoom(room);
    this.broadcastLobby();
    reply(ack, { ok: true, data: null });
  }

  /**
   * 台灣麻將：輪到電腦座位（不管是要出牌、自摸決策、還是回應吃碰槓胡）時，
   * 固定延遲 MAHJONG_NPC_DELAY_MS 後自動幫它做決定，遠比真人的 1 分鐘思考時間短，
   * 不然補電腦玩家測試會卡在每一步都要等真人的逾時時間。
   */
  private scheduleMahjongNpc(room: Room): void {
    if (room.npcTimer) {
      clearTimeout(room.npcTimer);
      room.npcTimer = null;
    }

    const game = room.game;
    if (game?.type !== 'taiwanMahjong' || game.state.over) return;
    const { phase } = game.state;
    if (phase !== 'discard' && phase !== 'selfDraw' && phase !== 'reaction') return;

    const actingSeat = phase === 'reaction' ? (game.state.reaction?.respondSeat ?? null) : game.state.turnSeat;
    if (actingSeat === null) return;
    const playerId = room.seats[actingSeat];
    const member = playerId ? room.players.get(playerId) : undefined;
    if (!member?.isNpc) return;

    // 開局擲骰動畫還沒播完的話，電腦座位要跟真人一樣等，不能搶在畫面翻牌前就出手。
    const dealRemaining = room.mahjongDealUntil ? Math.max(0, room.mahjongDealUntil - Date.now()) : 0;
    const delay = Math.max(MAHJONG_NPC_DELAY_MS, dealRemaining);

    room.npcTimer = setTimeout(() => {
      room.npcTimer = null;
      if (this.rooms.get(room.id) !== room || room.game !== game) return; // 房間或這一局已經被換掉了
      this.runMahjongNpcAction(room, game.state);
    }, delay);
  }

  private runMahjongNpcAction(room: Room, state: MahjongState): void {
    const context = {
      allDiscards: state.players.map((p) => p.discards),
      allMeldsPublic: state.players.map((p, seat) => ({ seat, melds: p.melds })),
      wallCount: state.wall.length,
      bankerSeat: state.bankerSeat,
    };

    if (state.phase === 'discard') {
      const seat = state.turnSeat;
      const playerId = room.seats[seat];
      const player = state.players[seat];
      if (playerId && player) {
        const tile = aiChooseDiscard(player, context);
        const result = discardTile(room.seats, state, playerId, tile);
        if (result.ok) pushLog(room, { t: 'mahjongDiscard', player: nicknameOf(room, playerId), tile });
      }
    } else if (state.phase === 'selfDraw' && state.selfDraw) {
      const seat = state.turnSeat;
      const playerId = room.seats[seat];
      const player = state.players[seat];
      if (playerId && player) {
        const before = state.roundResult;
        const decision = aiSelfDrawAction(player, state.selfDraw);
        const gangsBefore = gangTileSnapshot(state);
        const result = chooseSelfDrawAction(room.seats, state, playerId, decision.action, decision.tile);
        if (result.ok) pushMahjongGangLogs(room, gangsBefore, state);
        this.logMahjongRoundEnd(room, state, before);
      }
    } else if (state.phase === 'reaction' && state.reaction) {
      const reaction = state.reaction;
      const playerId = room.seats[reaction.respondSeat];
      const player = state.players[reaction.respondSeat];
      if (playerId && player) {
        const before = state.roundResult;
        const decision = aiRespond(player, reaction.options, {
          ...context,
          discardedTile: reaction.discardedTile,
          chiOptions: reaction.chiOptions,
        });
        const gangsBefore = gangTileSnapshot(state);
        const result = respondToReaction(room.seats, state, playerId, decision.action, decision.chiTiles);
        if (result.ok && decision.action !== 'pass' && decision.action !== 'hu') {
          pushLog(room, {
            t: 'mahjongMeld',
            player: nicknameOf(room, playerId),
            kind: decision.action,
            tiles: [reaction.discardedTile],
          });
        } else if (result.ok && decision.action === 'pass') {
          // 同上：電腦放棄搶槓，可能是幫別人（也可能是另一個電腦）補完加槓。
          pushMahjongGangLogs(room, gangsBefore, state);
        }
        this.logMahjongRoundEnd(room, state, before);
      }
    }

    this.afterGameAction(room);
  }
}
