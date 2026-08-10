# syntax=docker/dockerfile:1

# ---- deps：只裝 server 的執行期相依 ----
# 限定 workspace，否則 client 的 react / socket.io-client 也會裝進執行期映像。
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --include-workspace-root

# ---- builder：全套相依，打包前端 ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
# vite 是在 build 當下把 VITE_ 開頭的變數寫死進 bundle 的，執行期再設就沒人看了，
# 所以前後端分家時要在這裡用 --build-arg 帶進來。
ARG VITE_SERVER_URL=
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN npm run build

# ---- server：只有 API。映像裡沒有 client/dist，index.ts 的 existsSync 就不掛前端 ----
FROM node:24-slim AS server
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY server/ ./server/
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 等同 npm start -w server，但少一層 npm 行程，SIGTERM 直接進 node
CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]

# ---- fullstack（預設 target）：多帶一份打包好的前端，等同 npm run serve ----
FROM server AS fullstack
COPY --from=builder /app/client/dist ./client/dist
