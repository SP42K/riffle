import { useState, type FormEvent } from 'react';
import { Lobby } from './pages/Lobby';
import { Room } from './pages/Room';
import { useGame } from './state/GameProvider';
import { useSkin } from './state/skinContext';

/** 還沒設暱稱前不連線，先讓玩家取名字。 */
function NicknameGate() {
  const { saveNickname } = useGame();
  const { t } = useSkin();
  const [draft, setDraft] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveNickname(draft);
  };

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <h1>
          {t('gate.title')} <span className="lobby__header-en">{t('gate.titleAccent')}</span>
        </h1>
        <p className="muted">{t('gate.subtitle')}</p>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('gate.nicknamePlaceholder')}
          maxLength={12}
          autoFocus
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
          {t('gate.submit')}
        </button>
      </form>
    </div>
  );
}

export function App() {
  const { nickname, room, toast } = useGame();

  return (
    <>
      {!nickname ? <NicknameGate /> : room ? <Room room={room} /> : <Lobby />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
