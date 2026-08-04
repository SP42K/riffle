import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from 'shared';

interface Props {
  title: string;
  messages: ChatMessage[];
  myPlayerId: string;
  onSend: (text: string) => void;
}

/** 大廳與房間共用同一個面板，差別只在傳進來的訊息與送出函式。 */
export function ChatPanel({ title, messages, myPlayerId, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <section className="chat">
      <h2 className="chat__title">{title}</h2>
      <div className="chat__list" ref={listRef}>
        {messages.length === 0 && <p className="chat__empty">還沒有人說話</p>}
        {messages.map((message) => (
          <p
            key={message.id}
            className={[
              'chat__line',
              message.system ? 'chat__line--system' : '',
              message.playerId === myPlayerId ? 'chat__line--mine' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {!message.system && <span className="chat__author">{message.nickname}</span>}
            <span className="chat__text">{message.text}</span>
          </p>
        ))}
      </div>
      <form className="chat__form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="說點什麼…"
          maxLength={200}
        />
        <button type="submit" disabled={!draft.trim()}>
          送出
        </button>
      </form>
    </section>
  );
}
