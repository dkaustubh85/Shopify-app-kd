FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG DATABASE_PROVIDER=sqlite
ENV DATABASE_PROVIDER=$DATABASE_PROVIDER
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN if [ "$DATABASE_PROVIDER" = "postgresql" ]; then npx prisma generate --schema prisma/postgresql/schema.prisma; else npx prisma generate; fi
RUN npm run build
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG DATABASE_PROVIDER=sqlite
ENV NODE_ENV=production PORT=3000 DATABASE_URL=file:/data/stocksheet.sqlite DATABASE_PROVIDER=$DATABASE_PROVIDER
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
RUN npm prune --omit=dev && mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME /data
CMD ["npm", "run", "docker-start"]
