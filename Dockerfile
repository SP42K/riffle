# syntax=docker/dockerfile:1

# ---- deps：只裝執行期相依 ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev

# ---- builder：全套相依，打包前端 ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

# ---- server：只有 API。映像裡沒有 client/dist，index.ts:29 的 existsSync 就不掛前端 ----
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
