FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 libreoffice-writer \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm install

COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 libreoffice-writer \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm install --omit=dev

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/scripts ./server/scripts
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "server"]
