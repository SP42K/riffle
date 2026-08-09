/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 後端網域，例如 https://game.example.com；沒設就走同源。 */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
