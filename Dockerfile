# ---------- Build: Client mit Vite bauen ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---------- Laufzeit: Spielserver liefert auch den gebauten Client aus ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=2567 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 2567
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s CMD wget -qO /dev/null http://127.0.0.1:2567/ || exit 1
# node direkt starten (nicht über npm/npx), damit SIGTERM ankommt und die Spielstände gespeichert werden
CMD ["node", "--import", "tsx", "server/src/index.ts"]
