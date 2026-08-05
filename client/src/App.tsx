import { useState, type FormEvent } from 'react';
import { Lobby } from './pages/Lobby';
import { Room } from './pages/Room';
import { useGame } from './state/GameProvider';

/** 還沒設暱稱前不連線，先讓玩家取名字。 */
function NicknameGate() {
  const { saveNickname } = useGame();
  const [draft, setDraft] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveNickname(draft);
  };

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <h1>
          線上牌桌 <span className="lobby__header-en">Online</span>
        </h1>
        <p className="muted">大老二 2~4 人、德州撲克 2~9 人，可開房、加入、觀戰</p>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="輸入暱稱"
          maxLength={12}
          autoFocus
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
          開始
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
