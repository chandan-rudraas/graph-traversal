# build context = repo root (the engine is shared with the web app)
FROM node:22-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev
COPY api/server.js api/neo4jStore.js ./
COPY web/src/engine.js ./engine.js
EXPOSE 3001
CMD ["node", "server.js"]
