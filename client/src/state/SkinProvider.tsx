import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useCoarsePointer } from '../hooks/useMediaQuery';
import { SkinSettings } from '../pages/SkinSettings';
import { SKINS, fill, resolveSkin } from '../skins';
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  SkinContext,
  hotkeyOf,
  isTyping,
  type Prefs,
  type SkinContextValue,
} from './skinContext';

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 兩次點擊之間超過這個時間就當成兩次單擊，不算連點。 */
const DOUBLE_TAP_MS = 350;

/** favicon 是動態插進去的：index.html 只放一個空殼，換外觀時改它的 href。 */
function applyFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

/**
 * 外觀與隱匿模式的總管：偏好持久化、快捷鍵、老闆鍵、失焦自動遮蔽，
 * 以及把假視窗外框包在整個 app 外面。
 */
export function SkinProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  /** 老闆鍵按出來的遮蔽，只認快捷鍵才會解除。 */
  const [bossHidden, setBossHidden] = useState(false);
  /** 失焦或滑鼠移出造成的遮蔽，回來就自動解除。 */
  const [autoHidden, setAutoHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const skin = useMemo(() => resolveSkin(prefs.skin), [prefs.skin]);
  const hidden = bossHidden || autoHidden;

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // 無痕模式之類寫不進去就算了，設定只是這次有效
      }
      return next;
    });
  }, []);

  const toggleBoss = useCallback(() => {
    setBossHidden((prev) => !prev);
    setAutoHidden(false);
  }, []);

  /**
   * 無條件解除遮蔽。連點遮蔽畫面要用這個而不是 toggleBoss：
   * 如果現在是失焦自動遮蔽（bossHidden 還是 false），toggleBoss 會把它翻成 true，
   * 點了畫面還是黑的——手機上沒有可靠的 focus 事件可以救回來。
   */
  const revealAll = useCallback(() => {
    setBossHidden(false);
    setAutoHidden(false);
  }, []);

  const coarsePointer = useCoarsePointer();
  // 連點偵測：記住上一次 pointerdown 的時間，夠近就算連點
  const lastTapRef = useRef(0);
  const onDoubleTap = useCallback((run: () => void) => {
    return (event: ReactPointerEvent) => {
      const now = event.timeStamp || Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        run();
        return;
      }
      lastTapRef.current = now;
    };
  }, []);

  /**
   * 觸控裝置的老闆鍵：右上角 48px 熱區連點兩下就遮蔽。
   * 用 document 監聽而不是鋪一塊透明 div——透明 div 會把底下按鈕
   * （離開房間、改當觀戰者這些就貼在右上角）的單擊整個吃掉；
   * 座標判斷讓單擊照常穿透，只有連點才動作。計時器跟遮蔽畫面的分開，互不干擾。
   */
  const cornerTapRef = useRef(0);
  useEffect(() => {
    if (!coarsePointer || hidden) return;
    const CORNER_PX = 48;
    const onPointerDown = (event: PointerEvent) => {
      if (event.clientX < window.innerWidth - CORNER_PX || event.clientY > CORNER_PX) return;
      const now = event.timeStamp || Date.now();
      if (now - cornerTapRef.current < DOUBLE_TAP_MS) {
        cornerTapRef.current = 0;
        toggleBoss();
        return;
      }
      cornerTapRef.current = now;
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [coarsePointer, hidden, toggleBoss]);

  // 外觀套用到 <html>，CSS 全靠這個屬性分支
  useEffect(() => {
    document.documentElement.dataset.skin = skin.id;
  }, [skin.id]);

  // 分頁標題與 favicon。被遮蔽時一律用外觀的標題，不讓標題列穿幫
  useEffect(() => {
    if (!prefs.swapTitle) return;
    document.title = skin.docTitle;
    applyFavicon(skin.favicon);
  }, [skin, prefs.swapTitle]);

  // 快捷鍵：切換外觀與老闆鍵
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const combo = hotkeyOf(event);
      if (!combo) return;

      if (combo === prefs.hotkeyBoss) {
        event.preventDefault();
        toggleBoss();
        return;
      }
      if (combo === prefs.hotkeyCycle) {
        event.preventDefault();
        const index = SKINS.findIndex((s) => s.id === prefs.skin);
        setPrefs({ skin: SKINS[(index + 1) % SKINS.length]!.id });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [prefs.hotkeyBoss, prefs.hotkeyCycle, prefs.skin, setPrefs, toggleBoss]);

  // 失焦 / 滑鼠移出視窗自動遮蔽
  useEffect(() => {
    const clear = () => {
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
    const hideSoon = () => {
      clear();
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setAutoHidden(true);
      }, prefs.autoHideDelayMs);
    };
    const show = () => {
      clear();
      setAutoHidden(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hideSoon();
      else show();
    };
    // 點自家 input 也會觸發 window blur，用 hasFocus() 濾掉
    const onBlur = () => {
      if (!document.hasFocus()) hideSoon();
    };
    const onMouseOut = (event: MouseEvent) => {
      if (!event.relatedTarget) hideSoon();
    };

    if (prefs.autoHideOnBlur) {
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onBlur);
    }
    if (prefs.autoHideOnMouseLeave) {
      document.addEventListener('mouseout', onMouseOut);
      document.addEventListener('mouseover', show);
    }
    window.addEventListener('focus', show);

    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mouseover', show);
      window.removeEventListener('focus', show);
    };
  }, [prefs.autoHideOnBlur, prefs.autoHideOnMouseLeave, prefs.autoHideDelayMs]);

  const value = useMemo<SkinContextValue>(
    () => ({
      skin,
      prefs,
      setPrefs,
      t: (key, vars) => fill(skin.text[key], vars),
      hidden,
      toggleBoss,
      settingsOpen,
      setSettingsOpen,
    }),
    [skin, prefs, setPrefs, hidden, toggleBoss, settingsOpen],
  );

  return (
    <SkinContext.Provider value={value}>
      {/* 遮蔽時不解除掛載，socket 與牌局狀態要活著，回來才是最新的畫面 */}
      <div className="app-root" data-hidden={hidden ? 'true' : undefined} aria-hidden={hidden}>
        {skin.Chrome({ children })}
      </div>

      {!hidden && (
        <button
          type="button"
          className="skin-gear"
          title="Settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4a9 9 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a9 9 0 0 0-2.2-1.3L16 3H8l-.3 2.4a9 9 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a9 9 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a9 9 0 0 0 2.2 1.3L8 21h8l.3-2.4a9 9 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z" />
          </svg>
        </button>
      )}

      {settingsOpen && !hidden && <SkinSettings />}
      {hidden && (
        <div
          className="boss-screen"
          onPointerDown={coarsePointer ? onDoubleTap(revealAll) : undefined}
        >
          {skin.Boss()}
        </div>
      )}
    </SkinContext.Provider>
  );
}
