FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5001

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/auth.js ./auth.js
COPY --from=build /app/artwork_metadata.js ./artwork_metadata.js
COPY --from=build /app/dist ./dist

EXPOSE 5001
USER node
CMD ["node", "server.js"]