import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameProvider } from './state/GameProvider';
import { SkinProvider } from './state/SkinProvider';
import './styles.css';
import './skins/skins.css';

const isDownstairsPveReview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('dev') === 'downstairs-pve';
const isDownstairsPveRuntimeReview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('dev') === 'downstairs-runtime';
const DownstairsPvePrototype = import.meta.env.DEV
  ? lazy(() => import('./features/downstairs-pve/DownstairsPvePrototype'))
  : null;
const DownstairsPveRuntimeFixture = import.meta.env.DEV
  ? lazy(() => import('./features/downstairs-pve/DownstairsPveRuntimeFixture'))
  : null;

// SkinProvider 在外面：GameProvider 的錯誤提示要照外觀翻譯
createRoot(document.getElementById('root')!).render(
  <SkinProvider>
    {isDownstairsPveRuntimeReview && DownstairsPveRuntimeFixture ? (
      <Suspense fallback={<div className="gate"><div className="gate__card">載入正式 PvE 畫面…</div></div>}>
        <DownstairsPveRuntimeFixture />
      </Suspense>
    ) : isDownstairsPveReview && DownstairsPvePrototype ? (
      <Suspense fallback={<div className="gate"><div className="gate__card">載入 PvE UI 設計稿…</div></div>}>
        <DownstairsPvePrototype />
      </Suspense>
    ) : (
      <GameProvider>
        <App />
      </GameProvider>
    )}
  </SkinProvider>,
);
