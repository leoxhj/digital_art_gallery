FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PGHOST=127.0.0.1 \
    PGPORT=5432 \
    PGDATA=/var/lib/postgresql/data \
    PORT=5001

RUN apt-get update \
        && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
        && mkdir -p /usr/share/postgresql-common/pgdg /etc/postgresql-common \
        && echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf \
        && curl --fail --silent --show-error --location https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
        && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' \
            > /etc/apt/sources.list.d/pgdg.list \
        && apt-get update \
        && apt-get install -y --no-install-recommends postgresql-18 postgresql-client-18 supervisor gosu \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/postgresql/data /var/run/postgresql \
    && chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/artwork_metadata.js ./artwork_metadata.js
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/gallery-entrypoint
COPY docker/supervisord.conf /etc/supervisor/conf.d/gallery.conf
RUN chmod 0755 /usr/local/bin/gallery-entrypoint

VOLUME ["/var/lib/postgresql/data"]
EXPOSE 5001
ENTRYPOINT ["/usr/local/bin/gallery-entrypoint"]
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/gallery.conf"]