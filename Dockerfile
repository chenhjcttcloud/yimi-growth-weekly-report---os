FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN ./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build --emptyOutDir false

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 unzip ca-certificates tzdata
WORKDIR /app
ENV NODE_ENV=production SERVER_PORT=5174 STATIC_DIR=dist
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node package.json ./
RUN mkdir -p outputs && chown node:node outputs
USER node
EXPOSE 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:5174/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
