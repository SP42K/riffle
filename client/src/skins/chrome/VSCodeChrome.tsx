import type { ReactNode } from 'react';

/** 活動列的線條圖示，畫成 SVG 免得動到字型。 */
const ICONS = [
  'M3 4h7l2 2h9v13H3V4Z', // 檔案總管
  'M11 4a7 7 0 1 0 4.2 12.6L20 21l1.4-1.4-4.8-4.8A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z', // 搜尋
  'M6 3a3 3 0 0 0-1 5.8V15A3 3 0 1 0 7 15V8.8A3 3 0 0 0 6 3Zm12 0a3 3 0 0 0-1 5.8V11a3 3 0 0 1-3 3h-2v2h2a5 5 0 0 0 5-5V8.8A3 3 0 0 0 18 3Z', // 原始檔控制
  'M12 3 3 7v6c0 5 3.8 9.2 9 10 5.2-.8 9-5 9-10V7l-9-4Z', // 偵錯
  'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z', // 擴充功能
];

const TABS = ['index.ts', 'session.ts', 'queue.ts'];

/**
 * 假的編輯器外框。純裝飾，沒有任何狀態 ——
 * 遊戲內容整塊塞在「編輯區」裡，遠看就是有人開著 VS Code。
 */
export function VSCodeChrome({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="chrome chrome--code">
      <div className="chrome__titlebar">
        <span className="chrome__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="chrome__menu">
          <span>File</span>
          <span>Edit</span>
          <span>Selection</span>
          <span>View</span>
          <span>Go</span>
          <span>Run</span>
          <span>Terminal</span>
          <span>Help</span>
        </span>
        <span className="chrome__title">session.ts — workspace — Visual Studio Code</span>
      </div>

      <div className="chrome__main">
        <nav className="chrome__activity" aria-hidden="true">
          {ICONS.map((d, i) => (
            <svg key={i} viewBox="0 0 24 24" className={i === 2 ? 'is-active' : undefined}>
              <path d={d} />
            </svg>
          ))}
        </nav>

        <div className="chrome__editor">
          <div className="chrome__tabs">
            {TABS.map((name, i) => (
              <span key={name} className={i === 1 ? 'chrome__tab is-active' : 'chrome__tab'}>
                {name}
              </span>
            ))}
          </div>
          <div className="chrome__content">{children}</div>
        </div>
      </div>

      <div className="chrome__statusbar">
        <span>main*</span>
        <span>0 ⚠ 0 ⓘ</span>
        <span className="chrome__spacer" />
        <span>Ln 42, Col 8</span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
        <span>TypeScript</span>
      </div>
    </div>
  );
}
