import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameProvider } from './state/GameProvider';
import { SkinProvider } from './state/SkinProvider';
import './styles.css';
import './skins/skins.css';

// SkinProvider 在外面：GameProvider 的錯誤提示要照外觀翻譯
createRoot(document.getElementById('root')!).render(
  <SkinProvider>
    <GameProvider>
      <App />
    </GameProvider>
  </SkinProvider>,
);
