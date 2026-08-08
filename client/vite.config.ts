import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 直接吃 shared 的原始碼，型別與規則引擎跟伺服器共用同一份
    alias: { shared: sharedSrc },
  },
  server: {
    // 綁 0.0.0.0，同區網的其他裝置也能連 dev server。
    // 要換連接埠直接用 Vite 的旗標：npm run dev -w client -- --port 80
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:3005', ws: true },
    },
  },
});
