import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from 'shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * 儲存鍵刻意取得中性 —— 舊的 'bigtwo:' 前綴在 devtools 裡一看就穿幫。
 * 讀不到新 key 時會把舊 key 搬過來再刪掉，升級的人不會被登出。
 */
const PLAYER_ID_KEY = 'ws.sid';
const NICKNAME_KEY = 'ws.user';
const LEGACY_PLAYER_ID_KEY = 'bigtwo:playerId';
const LEGACY_NICKNAME_KEY = 'bigtwo:nickname';

function migrate(store: Storage, from: string, to: string): string | null {
  const value = store.getItem(to) ?? store.getItem(from);
  if (value !== null) store.setItem(to, value);
  store.removeItem(from);
  return value;
}

/**
 * 產生一組 UUID v4。
 * 不直接用 crypto.randomUUID()：它只存在於安全環境（HTTPS 或 localhost），
 * 用區網 IP 走 http 連進來時會是 undefined。getRandomValues 沒有這個限制。
 */
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 這個分頁的身分，斷線重連靠它認人。
 * 用 sessionStorage 而不是 localStorage：它一樣撐得過 F5 重整，
 * 但每個分頁各自獨立，同一台電腦開多個分頁就是多個玩家（測試跟雙開都方便）。
 */
export function getPlayerId(): string {
  let id = migrate(sessionStorage, LEGACY_PLAYER_ID_KEY, PLAYER_ID_KEY);
  if (!id) {
    id = randomId();
    sessionStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getStoredNickname(): string {
  return migrate(localStorage, LEGACY_NICKNAME_KEY, NICKNAME_KEY) ?? '';
}

export function storeNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname);
}

export const socket: GameSocket = io({ autoConnect: false });

/** 伺服器回錯時丟出來的錯誤。帶 code 是為了讓前端能依外觀換掉文案。 */
export class AckError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AckError';
  }
}

/** 把 socket.io 的 ack 包成 Promise，失敗時 reject 一個 AckError。 */
export function emitWithAck<E extends keyof ClientToServerEvents, T>(
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ack: Ack<T> = (res) => {
      if (res.ok) resolve(res.data);
      else reject(new AckError(res.error.code, res.error.message));
    };
    // socket.io 的型別推不出這種泛型轉發，這裡直接放行
    (socket.emit as (event: E, payload: unknown, ack: unknown) => void)(event, payload, ack);
  });
}
