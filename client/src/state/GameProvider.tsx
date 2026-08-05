import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ChatMessage, RoomSummary, RoomView } from 'shared';
import {
  AckError,
  emitWithAck,
  getPlayerId,
  getStoredNickname,
  socket,
  storeNickname,
} from '../net/socket';
import { useSkin } from './skinContext';

interface GameContextValue {
  connected: boolean;
  nickname: string;
  saveNickname: (nickname: string) => void;
  rooms: RoomSummary[];
  lobbyMessages: ChatMessage[];
  roomMessages: ChatMessage[];
  room: RoomView | null;
  toast: string | null;
  showToast: (message: string) => void;
  /** 統一處理需要 ack 的動作：失敗就跳提示，不用每個呼叫端各寫一次 try/catch。 */
  run: (action: () => Promise<unknown>) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame 必須在 GameProvider 裡使用');
  return value;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { skin, t } = useSkin();
  const [connected, setConnected] = useState(false);
  const [nickname, setNickname] = useState(getStoredNickname);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [lobbyMessages, setLobbyMessages] = useState<ChatMessage[]>([]);
  const [roomMessages, setRoomMessages] = useState<ChatMessage[]>([]);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  /** 伺服器的訊息是中文的牌類用語，隱匿模式下要換成外觀自己的說法。 */
  const localizeError = useCallback(
    (code: string, message: string) => skin.errors[code] ?? message,
    [skin],
  );

  const run = useCallback(
    (action: () => Promise<unknown>) => {
      action().catch((error: unknown) => {
        if (error instanceof AckError) showToast(localizeError(error.code, error.message));
        else showToast(error instanceof Error ? error.message : t('toast.failed'));
      });
    },
    [showToast, localizeError, t],
  );

  const saveNickname = useCallback((next: string) => {
    const trimmed = next.trim().slice(0, 12);
    if (!trimmed) return;
    storeNickname(trimmed);
    setNickname(trimmed);
  }, []);

  // 有暱稱才連線；暱稱改了就重打一次招呼，讓伺服器更新顯示名稱
  useEffect(() => {
    if (!nickname) return;

    const hello = () => {
      setConnected(true);
      void emitWithAck('session:hello', { playerId: getPlayerId(), nickname }).catch(() => {
        /* 連線層自己會重試 */
      });
    };

    const onDisconnect = () => setConnected(false);

    socket.on('connect', hello);
    socket.on('disconnect', onDisconnect);
    socket.on('lobby:state', (payload) => setRooms(payload.rooms));
    socket.on('lobby:chat', (payload) => setLobbyMessages(payload.messages));
    socket.on('room:chat', (payload) => setRoomMessages(payload.messages));
    socket.on('room:state', (payload) => {
      setRoom(payload);
      if (!payload) setRoomMessages([]);
    });
    socket.on('error', (payload) => showToast(localizeError(payload.code, payload.message)));

    if (socket.connected) hello();
    else socket.connect();

    return () => {
      socket.off('connect', hello);
      socket.off('disconnect', onDisconnect);
      socket.off('lobby:state');
      socket.off('lobby:chat');
      socket.off('room:chat');
      socket.off('room:state');
      socket.off('error');
    };
  }, [nickname, showToast, localizeError]);

  const value = useMemo<GameContextValue>(
    () => ({
      connected,
      nickname,
      saveNickname,
      rooms,
      lobbyMessages,
      roomMessages,
      room,
      toast,
      showToast,
      run,
    }),
    [connected, nickname, saveNickname, rooms, lobbyMessages, roomMessages, room, toast, showToast, run],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
