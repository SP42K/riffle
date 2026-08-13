import { useEffect, useState } from 'react';
import { SKINS } from '../skins';
import { hotkeyOf, useSkin } from '../state/skinContext';

/** 快捷鍵錄製：按下 [設定] 後接住下一次按鍵，直接存成 'Ctrl+Shift+Q' 這種字串。 */
function HotkeyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (combo: string) => void;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }
      const combo = hotkeyOf(event);
      if (!combo) return; // 還按在修飾鍵上，等真正的那一鍵
      onChange(combo);
      setRecording(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onChange]);

  return (
    <button
      type="button"
      className={recording ? 'btn btn--primary skin-settings__hotkey' : 'btn skin-settings__hotkey'}
      onClick={() => setRecording((prev) => !prev)}
    >
      {recording ? '按下想用的按鍵…（Esc 取消）' : value}
    </button>
  );
}

/** 外觀與隱匿設定。這一頁的字永遠是中文，但用詞刻意跟牌類無關。 */
export function SkinSettings() {
  const { prefs, setPrefs, setSettingsOpen, toggleBoss } = useSkin();

  return (
    <div className="skin-settings__backdrop" onClick={() => setSettingsOpen(false)}>
      <div
        className="skin-settings"
        role="dialog"
        aria-label="外觀與隱匿設定"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="skin-settings__head">
          <h2>外觀與隱匿</h2>
          <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
            關閉
          </button>
        </header>

        <section className="skin-settings__group">
          <h3>外觀</h3>
          <div className="skin-settings__skins">
            {SKINS.map((skin) => (
              <button
                key={skin.id}
                type="button"
                className={prefs.skin === skin.id ? 'btn btn--primary' : 'btn'}
                onClick={() => setPrefs({ skin: skin.id })}
              >
                {skin.label}
              </button>
            ))}
          </div>
        </section>

        <section className="skin-settings__group">
          <h3>快捷鍵</h3>
          <label className="skin-settings__row">
            <span>循環切換外觀</span>
            <HotkeyField
              value={prefs.hotkeyCycle}
              onChange={(combo) => setPrefs({ hotkeyCycle: combo })}
            />
          </label>
          <label className="skin-settings__row">
            <span>一鍵全遮（再按一次還原）</span>
            <HotkeyField
              value={prefs.hotkeyBoss}
              onChange={(combo) => setPrefs({ hotkeyBoss: combo })}
            />
          </label>
          <label className="skin-settings__row">
            <span>現在就遮起來</span>
            <button type="button" className="btn" onClick={toggleBoss}>
              立即遮蔽
            </button>
          </label>
          <p className="muted">在輸入框裡打字時不會觸發快捷鍵。</p>
          <p className="muted">觸控裝置：連點右上角可遮蔽，連點遮蔽畫面可恢復。</p>
        </section>

        <section className="skin-settings__group">
          <h3>自動遮蔽</h3>
          <label className="skin-settings__row">
            <span>切到別的分頁或視窗失焦時</span>
            <input
              type="checkbox"
              checked={prefs.autoHideOnBlur}
              onChange={(event) => setPrefs({ autoHideOnBlur: event.target.checked })}
            />
          </label>
          <label className="skin-settings__row">
            <span>滑鼠移出視窗時</span>
            <input
              type="checkbox"
              checked={prefs.autoHideOnMouseLeave}
              onChange={(event) => setPrefs({ autoHideOnMouseLeave: event.target.checked })}
            />
          </label>
          <label className="skin-settings__row">
            <span>延遲 {(prefs.autoHideDelayMs / 1000).toFixed(1)} 秒後遮蔽</span>
            <input
              type="range"
              min={0}
              max={5000}
              step={100}
              value={prefs.autoHideDelayMs}
              onChange={(event) => setPrefs({ autoHideDelayMs: Number(event.target.value) })}
            />
          </label>
        </section>

        <section className="skin-settings__group">
          <h3>其他</h3>
          <label className="skin-settings__row">
            <span>分頁標題與圖示跟著外觀換</span>
            <input
              type="checkbox"
              checked={prefs.swapTitle}
              onChange={(event) => setPrefs({ swapTitle: event.target.checked })}
            />
          </label>
          <p className="muted">
            提醒：暱稱、房名與聊天內容是你自己打的字，外觀換不掉，取名時避開會露餡的詞。
          </p>
        </section>
      </div>
    </div>
  );
}
