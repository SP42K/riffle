import type { ReactNode } from 'react';

const HISTORY = [
  { prompt: 'user@host:~/work$ ', cmd: 'git status --short' },
  { out: ' M src/session.ts' },
  { out: ' M src/queue.ts' },
  { prompt: 'user@host:~/work$ ', cmd: 'npm run watch -- --verbose' },
];

/** 假的終端機外框。上面幾行是靜態的歷史紀錄，下面接遊戲內容當成指令輸出。 */
export function TerminalChrome({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="chrome chrome--term">
      <div className="chrome__titlebar">
        <span className="chrome__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="chrome__title">user@host: ~/work</span>
      </div>

      <div className="chrome__scroll">
        <div className="chrome__history" aria-hidden="true">
          {HISTORY.map((line, i) => (
            <p key={i}>
              {line.prompt && <span className="chrome__prompt">{line.prompt}</span>}
              {line.cmd ?? line.out}
            </p>
          ))}
        </div>
        <div className="chrome__content">{children}</div>
      </div>
    </div>
  );
}
