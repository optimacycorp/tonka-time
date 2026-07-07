FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install

COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install --omit=dev

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "server"]
