// vite/client 已經由 client/tsconfig.json 的 types 掛上，這裡只補自己的變數。
interface ImportMetaEnv {
  /** 後端網域，例如 https://game.example.com；沒設就走同源。build 時寫死，執行期改沒有用。 */
  readonly VITE_SERVER_URL?: string;
}
