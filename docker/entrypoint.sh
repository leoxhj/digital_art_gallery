#!/bin/sh
set -eu

: "${PGDATABASE:=digital_art_gallery}"
: "${PGUSER:=gallery}"
: "${PGPASSWORD:?Set PGPASSWORD before starting the container}"
: "${PGPORT:=5432}"
: "${PGDATA:=/var/lib/postgresql/data}"
: "${PGHOST:=127.0.0.1}"
export PGDATABASE PGUSER PGPASSWORD PGPORT PGDATA PGHOST

PG_BIN="/usr/lib/postgresql/18/bin"
install -d -o postgres -g postgres -m 0700 "$PGDATA"
install -d -o postgres -g postgres -m 0755 /var/run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  gosu postgres "$PG_BIN/initdb" \
    -D "$PGDATA" \
    --locale=C.UTF-8 \
    --encoding=UTF8 \
    --auth-local=peer \
    --auth-host=scram-sha-256
fi

gosu postgres "$PG_BIN/pg_ctl" \
  -D "$PGDATA" \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/var/run/postgresql" \
  -w start

gosu postgres "$PG_BIN/psql" \
  --host=/var/run/postgresql \
  --username=postgres \
  --dbname=postgres \
  --set=ON_ERROR_STOP=1 \
  --set=app_user="$PGUSER" \
  --set=app_password="$PGPASSWORD" \
  --set=app_database="$PGDATABASE" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'app_database', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_database')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_database', :'app_user')
\gexec
SQL

gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop
exec "$@"