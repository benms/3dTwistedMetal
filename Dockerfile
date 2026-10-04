# Wreckyard game server. The browser client is deployed separately (see vercel.json).

# Build stage: bundle the server and the shared simulation into one file.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
RUN npm run build:server

# Runtime stage: Node and the bundle only; ws and the simulation are inlined.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app
COPY --from=build --chown=node:node /app/build/server.cjs ./server.cjs
USER node
# Informational; the platform injects PORT and the server binds it.
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Exec form keeps Node as PID 1 so it receives SIGTERM and shuts down gracefully.
CMD ["node", "server.cjs"]
