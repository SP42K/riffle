import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameProvider } from './state/GameProvider';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <GameProvider>
    <App />
  </GameProvider>,
);
