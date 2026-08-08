import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from 'shared';
import { GameServer } from './handlers.js';

/** 讀 `--name value` 形式的命令列參數。Windows 上比設環境變數好用。 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const PORT = Number(arg('port') ?? process.env.PORT ?? 3005);
/** 預設綁在所有網卡上，同區網的手機／其他電腦才連得進來。 */
const HOST = arg('host') ?? process.env.HOST ?? '0.0.0.0';

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, '../../client/dist');

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// 有打包好的前端就由同一個服務一起吐出去（單一連接埠就能玩）。
// 開發時前端走 Vite dev server + proxy，不會用到這裡。
const serveClient = existsSync(clientDist);
if (serveClient) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: true, credentials: true },
});

new GameServer(io);

/** 綁 0.0.0.0 時印出區網位址，方便直接把網址給別人。 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((info) =>
      info && info.family === 'IPv4' && !info.internal ? [info.address] : [],
    );
}

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[big-two] 連接埠 ${PORT} 已被占用，換一個：npm start -w server -- --port 8080`);
  } else if (error.code === 'EACCES') {
    console.error(`[big-two] 沒有權限綁定連接埠 ${PORT}，請用系統管理員身分執行，或改用 1024 以上的埠`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  const shown = PORT === 80 ? '' : `:${PORT}`;
  console.log(`[big-two] server listening on ${HOST}:${PORT}${serveClient ? '' : '（未附前端，請另開 Vite dev server）'}`);
  console.log(`[big-two]   本機   http://localhost${shown}`);
  if (HOST === '0.0.0.0') {
    for (const address of lanAddresses()) {
      console.log(`[big-two]   區網   http://${address}${shown}`);
    }
  }
});
