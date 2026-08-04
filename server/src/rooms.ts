import {
  CHAT_HISTORY,
  LOG_HISTORY,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ChatMessage,
  type Card,
  type GameView,
  type JoinMode,
  type PlayerId,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type SeatView,
} from 'shared';
import { seatOfPlayer, type GameState, type Seats } from './gameEngine.js';

export interface Member {
  playerId: PlayerId;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  /** 斷線寬限計時器，重新連上時要清掉。 */
  graceTimer: NodeJS.Timeout | null;
}

export interface PlayerMember extends Member {
  ready: boolean;
}

export interface Room {
  id: string;
  name: string;
  hostId: PlayerId;
  maxPlayers: number;
  seats: Seats;
  players: Map<PlayerId, PlayerMember>;
  spectators: Map<PlayerId, Member>;
  chat: ChatMessage[];
  log: string[];
  game: GameState | null;
  turnTimer: NodeJS.Timeout | null;
}

// ---------------------------------------------------------------------------
// 建立與成員進出
// ---------------------------------------------------------------------------

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 I/O/0/1

export function generateRoomId(taken: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = '';
    for (let i = 0; i < 4; i++) {
      id += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
    }
    if (!taken(id)) return id;
  }
  return `R${Date.now().toString(36).toUpperCase()}`;
}

export function clampMaxPlayers(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return MAX_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
}

export function createRoom(id: string, name: string, maxPlayers: number, host: Member): Room {
  const room: Room = {
    id,
    name,
    hostId: host.playerId,
    maxPlayers,
    seats: Array.from({ length: maxPlayers }, () => null),
    players: new Map(),
    spectators: new Map(),
    chat: [],
    log: [],
    game: null,
    turnTimer: null,
  };
  seatPlayer(room, host);
  return room;
}

/** 讓成員入座，回傳座位編號；沒有空位回 null。 */
export function seatPlayer(room: Room, member: Member): number | null {
  const seat = room.seats.indexOf(null);
  if (seat === -1) return null;
  room.seats[seat] = member.playerId;
  room.players.set(member.playerId, { ...member, ready: false });
  return seat;
}

export function addSpectator(room: Room, member: Member): void {
  room.spectators.set(member.playerId, member);
}

/**
 * 把成員從房間移除。
 * 遊戲進行中的玩家會空出座位，但手牌留著 —— 引擎會把空位當成不存在的座位跳過。
 */
export function removeMember(room: Room, playerId: PlayerId): void {
  const seat = room.seats.indexOf(playerId);
  if (seat !== -1) room.seats[seat] = null;
  room.players.delete(playerId);
  room.spectators.delete(playerId);

  if (room.hostId === playerId) {
    const nextHost = room.seats.find((id): id is PlayerId => id !== null);
    if (nextHost) room.hostId = nextHost;
  }
}

export function memberOf(room: Room, playerId: PlayerId): Member | undefined {
  return room.players.get(playerId) ?? room.spectators.get(playerId);
}

export function modeOf(room: Room, playerId: PlayerId): JoinMode | null {
  if (room.players.has(playerId)) return 'play';
  if (room.spectators.has(playerId)) return 'spectate';
  return null;
}

export function isEmpty(room: Room): boolean {
  return room.players.size === 0 && room.spectators.size === 0;
}

export function seatedPlayers(room: Room): PlayerMember[] {
  return room.seats.flatMap((id) => {
    const player = id ? room.players.get(id) : undefined;
    return player ? [player] : [];
  });
}

/** 開得了新局的條件：人數夠、而且除了房主以外都按了準備。 */
export function canStart(room: Room): boolean {
  const players = seatedPlayers(room);
  if (players.length < MIN_PLAYERS) return false;
  return players.every((p) => p.ready || p.playerId === room.hostId);
}

// ---------------------------------------------------------------------------
// 聊天與戰報
// ---------------------------------------------------------------------------

let messageSeq = 0;

export function makeChatMessage(
  nickname: string,
  text: string,
  playerId: PlayerId | null,
): ChatMessage {
  return { id: `m${++messageSeq}`, playerId, nickname, text, at: Date.now() };
}

export function makeSystemMessage(text: string): ChatMessage {
  return { id: `m${++messageSeq}`, playerId: null, nickname: '系統', text, at: Date.now(), system: true };
}

export function pushChat(history: ChatMessage[], message: ChatMessage): void {
  history.push(message);
  if (history.length > CHAT_HISTORY) history.splice(0, history.length - CHAT_HISTORY);
}

export function pushLog(room: Room, text: string): void {
  room.log.push(text);
  if (room.log.length > LOG_HISTORY) room.log.splice(0, room.log.length - LOG_HISTORY);
}

export function nicknameOf(room: Room, playerId: PlayerId): string {
  return memberOf(room, playerId)?.nickname ?? '(已離開)';
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

export function statusOf(room: Room): RoomStatus {
  if (!room.game) return 'waiting';
  return room.game.over ? 'finished' : 'playing';
}

export function buildSummary(room: Room): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    hostNickname: nicknameOf(room, room.hostId),
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    spectatorCount: room.spectators.size,
    status: statusOf(room),
  };
}

function buildSeats(room: Room): SeatView[] {
  const game = room.game;
  return room.seats.flatMap((playerId, seat) => {
    if (!playerId) return [];
    const player = room.players.get(playerId);
    if (!player) return [];
    const rankIndex = game ? game.finished.indexOf(playerId) : -1;
    return [
      {
        seat,
        playerId,
        nickname: player.nickname,
        isHost: playerId === room.hostId,
        ready: player.ready,
        connected: player.connected,
        handCount: game?.hands.get(playerId)?.length ?? 0,
        passed: game ? game.passedSeats.has(seat) : false,
        rank: rankIndex === -1 ? null : rankIndex + 1,
      } satisfies SeatView,
    ];
  });
}

function buildGameView(room: Room, game: GameState): GameView {
  const turnPlayerId = game.over ? null : (room.seats[game.turnSeat] ?? null);
  return {
    turnPlayerId,
    turnDeadline: game.turnDeadline,
    lastPlay: game.lastPlay
      ? {
          playerId: game.lastPlay.playerId,
          nickname: nicknameOf(room, game.lastPlay.playerId),
          combo: game.lastPlay.combo,
        }
      : null,
    freeLead: game.lastPlay === null,
    openingCardId: game.openingCardId,
    ranking: game.finished.slice(),
    over: game.over,
  };
}

/**
 * 為單一觀看者產生房間快照。
 * 玩家只拿得到自己的手牌；觀戰者是上帝視角，拿得到所有人的手牌。
 */
export function buildRoomView(room: Room, viewerId: PlayerId): RoomView | null {
  const mode = modeOf(room, viewerId);
  if (!mode) return null;

  const game = room.game;
  let allHands: Record<PlayerId, Card[]> | null = null;
  if (mode === 'spectate' && game) {
    allHands = {};
    for (const [playerId, cards] of game.hands) {
      if (room.players.has(playerId)) allHands[playerId] = cards;
    }
  }

  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    status: statusOf(room),
    seats: buildSeats(room),
    spectators: [...room.spectators.values()].map((s) => ({
      playerId: s.playerId,
      nickname: s.nickname,
    })),
    me: { playerId: viewerId, mode },
    hand: mode === 'play' ? (game?.hands.get(viewerId)?.slice() ?? []) : null,
    allHands,
    game: game ? buildGameView(room, game) : null,
    log: room.log.slice(),
  };
}

export { seatOfPlayer };
