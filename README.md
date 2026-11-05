# Digital Art Gallery

A small family art gallery for browsing, filtering, and uploading artwork. Artwork metadata and image bytes are stored in PostgreSQL so uploaded pieces remain available after the server restarts.

## Features

- Browse the gallery and filter works by any assigned section.
- Open an artwork for a larger view and its details.
- Switch the interface between English and Simplified Chinese. The language choice is saved in browser storage.
- Upload up to five local images at once with shared title, artist age, medium, multiple sections, optional description, and optional creation date.
- Select multiple gallery artworks and delete them together after confirmation.
- Close or reopen the upload panel; its open/closed state is saved in browser storage.
- Delete artwork from its detail view after confirmation.
- Store uploaded image bytes in PostgreSQL and serve them through the API.
- Automatically create the `drawings` table on startup. Artwork metadata and images are read from PostgreSQL; the backend does not seed or serve artwork from local files.

## Tech Stack

- **Frontend:** React 19, Vite 8, Tailwind CSS 4, i18next, react-i18next
- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL, accessed with `pg`
- **HTTPS:** Caddy reverse proxy with automatic TLS certificates
- **Uploads:** Multer multipart form handling; image data is stored in PostgreSQL `BYTEA` columns.
- **Configuration:** `dotenv` loads local environment settings from `.env`.

## Requirements

- Node.js and npm
- A running PostgreSQL server
- Docker Engine with Docker Compose (for the single-container deployment)

## Setup

1. Install dependencies:

	```sh
	npm install
	```

2. Create a PostgreSQL database. For example, from `psql`:

	```sql
	CREATE DATABASE digital_art_gallery;
	```

	The application creates the `drawings` table automatically. The database itself must exist before starting the API. Existing artwork records are read from this database; artwork images are not imported from local files.

3. Copy `.env.example` to `.env` and set your PostgreSQL credentials. In PowerShell:

	```powershell
	Copy-Item .env.example .env
	```

	Configure the `PG*` variables described below. Alternatively, set `DATABASE_URL` to a complete PostgreSQL connection string. When `DATABASE_URL` is set, it takes precedence over the separate `PG*` settings.

4. English and Simplified Chinese translations are bundled locally with i18next; no external translation service or credentials are required. Add or edit locale strings in `src/locales/en.json` and `src/locales/zh.json`.

5. Keep `.env` private. It is ignored by Git; do not commit database or translation credentials.

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PGHOST` | Yes, unless using `DATABASE_URL` | None | PostgreSQL server hostname, commonly `localhost`. |
| `PGDATABASE` | Yes, unless using `DATABASE_URL` | None | Name of the database created for the gallery. |
| `PGPORT` | No | `5432` | PostgreSQL server port. |
| `PGUSER` | Yes, unless using `DATABASE_URL` | None | PostgreSQL username. |
| `PGPASSWORD` | Yes, unless using `DATABASE_URL` | None | PostgreSQL password. |
| `DATABASE_URL` | No | None | Optional full connection string, for example `postgresql://user:password@localhost:5432/digital_art_gallery`. Takes precedence over `PG*` values. |
| `PORT` | No | `5001` | Port used by the Express API. The Vite proxy target is configured for port `5001`; update `vite.config.mjs` if you change this during development. |
| `DOMAIN` | No | `localhost` | Hostname served over HTTPS by Caddy. Use a public DNS name for browser-trusted automatic certificates, or `localhost` for local development. |
| `AUTHOR_BIRTHDAY` | No | `2017-09-04` | Author's birthday in `YYYY-MM-DD`; changing it and restarting the API recalculates stored artwork ages from creation dates. |
| `ARTWORK_AUTHOR` | No | None | Author name shown in the copyright watermark on gallery, detail, and original-size image views. |
| `WATERMARK_OPACITY` | No | `0.28` | Watermark opacity from `0` (hidden) to `1` (fully opaque). Adjust and restart the API to change visibility. |
| `WATERMARK_FONT_SIZE` | No | `16px` | Watermark font size in pixels; accepts `12px` or a bare number and is clamped to 6–64px. Restart the API after changing it. |

Example `.env` using separate settings:

```dotenv
PGHOST=localhost
PGDATABASE=digital_art_gallery
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PORT=5001
DOMAIN=localhost
AUTHOR_BIRTHDAY=2017-09-04
ARTWORK_AUTHOR=Rachel Xu
WATERMARK_OPACITY=0.28
WATERMARK_FONT_SIZE=16px
```

## Development

Run the API and frontend in separate terminals from the project directory.

Terminal 1, start the API (it connects to PostgreSQL, creates the table if needed, then listens on port `5001`):

```sh
npm start
```

Terminal 2, start Vite:

```sh
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`. Vite proxies `/api` requests to `http://localhost:5001`.

## Docker and HTTPS

Docker Compose runs three Linux containers: Caddy terminates HTTPS, the Node container serves the production-built frontend and Express API, and PostgreSQL 18 stores artwork. Database and certificate state persist in named volumes.

1. Copy `.env.example` to `.env` and set `PGPASSWORD` to a non-placeholder value. Configure `ARTWORK_AUTHOR` and other settings as needed.
2. Build and start the container:

	```sh
	docker compose up --build -d
	```

3. Set `DOMAIN` to a public hostname whose DNS points to this server and allow inbound ports 80 and 443 for browser-trusted automatic certificates. Start with `docker compose up --build -d`, then open `https://<DOMAIN>`; the API is available on the same HTTPS origin. Follow logs with `docker compose logs -f caddy gallery db`.

For local use, leave `DOMAIN=localhost` and open `https://localhost`. Caddy issues a local certificate, which browsers may warn about until its root CA is trusted. Export the local root certificate with `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt`, then trust that certificate on your development machine. Do not use the local CA setup for a public website.

Stop both containers with `docker compose down`; the database volume remains. To also erase the database, run `docker compose down -v`.

## Build

Create an optimized static frontend build:

```sh
npm run build
```

Vite writes the frontend output to `dist/`. `npm start` runs the Express API and serves `dist/` when it is present. The Node Docker image builds and serves the frontend alongside the API; PostgreSQL runs separately.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/drawings` | Return drawings, newest first. Each result includes an `imageUrl`. |
| `GET` | `/api/drawings/:id/image` | Return the stored image bytes with the original MIME type. |
| `GET` | `/api/drawings/:id/download` | Download a full-resolution copy with the configured copyright watermark. The stored original is unchanged. |
| `POST` | `/api/drawings` | Upload up to five images with shared metadata as `multipart/form-data`; creates one drawing per image atomically. |
| `DELETE` | `/api/drawings/:id` | Permanently delete a drawing and its stored image bytes. |

The upload form field names are `images` (multiple files), `title`, `age`, `medium`, `category` (section names separated by `|`), optional `description`, and optional `date` (`YYYY-MM-DD`). The API also accepts the legacy single-file field `image`. Up to five JPG, PNG, WebP, or GIF files can be uploaded at once; each must be no larger than 20 MB. Each image creates a drawing with the same submitted metadata. The backend validates file types and sizes, required metadata, and age range (0–120). On startup, the API adds the `categories` and `description` columns to existing `drawings` tables and backfills each existing drawing's section list from its `category` value.

The interface uses bundled i18next resources for English and Simplified Chinese. Built-in section and medium names have locale entries; user-defined names fall back to their original text. No artwork content or UI strings are sent to a translation provider.

## Project Layout

```text
.
├── museum_gallery.jsx     # Gallery, category filters, artwork details, upload form
├── server.js              # Express API, PostgreSQL schema, database-backed image uploads
├── src/
│   ├── main.jsx           # React browser entry point
│   ├── i18n.js            # i18next initialization
│   ├── locales/           # English and Simplified Chinese resources
│   └── styles.css         # Tailwind import and gallery/upload styles
├── public/                # Static frontend assets; gallery records are stored in PostgreSQL
├── index.html             # Vite HTML entry point
├── vite.config.mjs        # React/Tailwind plugins and API development proxy
├── .env.example           # Example local database configuration
└── package.json           # Dependencies and npm scripts
```

## Tests

Run the metadata validation tests with `npm test`. `npm run build` validates the frontend build, and `node --check server.js` checks backend JavaScript syntax. A live API check requires a running PostgreSQL server and configured credentials.