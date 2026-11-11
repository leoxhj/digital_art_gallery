# Digital Art Gallery

A small family art gallery for browsing, filtering, and uploading artwork. Artwork metadata and image bytes are stored in PostgreSQL so uploaded pieces remain available after the server restarts.

## Features

- Browse the gallery and filter works by any assigned section.
- Open an artwork for a larger view and its details.
- Switch the interface between English and Simplified Chinese. The language choice is saved in browser storage.
- Upload up to five local images at once with shared title, artist age, medium, multiple sections, optional description, and optional creation date.
- Select multiple gallery artworks and delete them together after confirmation.
- Curator-only login with ACL: only authorized users can add, edit, or delete artworks.
- Close or reopen the upload panel; its open/closed state is saved in browser storage.
- Delete artwork from its detail view after confirmation.
- Store uploaded image bytes in PostgreSQL and serve them through the API.
- Automatically create the `drawings` table on startup. Artwork metadata and images are read from PostgreSQL; the backend does not seed or serve artwork from local files.

## Tech Stack

- **Frontend:** React 19, Vite 8, Tailwind CSS 4, i18next, react-i18next
- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL, accessed with `pg`
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
| `AUTHOR_BIRTHDAY` | No | `2017-09-04` | Author's birthday in `YYYY-MM-DD`; changing it and restarting the API recalculates stored artwork ages from creation dates. |
| `ARTWORK_AUTHOR` | No | None | Author name shown in the copyright watermark on gallery, detail, and original-size image views. |
| `WATERMARK_OPACITY` | No | `0.28` | Watermark opacity from `0` (hidden) to `1` (fully opaque). Adjust and restart the API to change visibility. |
| `WATERMARK_FONT_SIZE` | No | `16px` | Watermark font size in pixels; accepts `12px` or a bare number and is clamped to 6–64px. Restart the API after changing it. |
| `AUTH_SECRET` | Yes | None | Random signing secret of at least 32 characters. Keep private. |
| `AUTH_SETUP_TOKEN` | Recommended | `AUTH_SECRET` | Separate random token required to create the first administrator through the UI. Keep private; used only during initial setup. |
| `AUTH_SESSION_TTL_SECONDS` | No | `43200` | Session lifetime in seconds (minimum `300`). |
| `AUTH_COOKIE_SECURE` | No | `true` in production, otherwise `false` | Set `true` for HTTPS. Set `false` only for local HTTP. Compose defaults to `false` for its documented local HTTP setup. |

Example `.env` using separate settings:

```dotenv
PGHOST=localhost
PGDATABASE=digital_art_gallery
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PORT=5001
AUTHOR_BIRTHDAY=2017-09-04
ARTWORK_AUTHOR=Rachel Xu
WATERMARK_OPACITY=0.28
WATERMARK_FONT_SIZE=16px
AUTH_SECRET=replace_with_a_long_random_secret
AUTH_SETUP_TOKEN=replace_with_a_different_random_setup_token
AUTH_SESSION_TTL_SECONDS=43200
AUTH_COOKIE_SECURE=false
```

## Access Control (ACL)

1. Configure `AUTH_SECRET` and preferably a separate `AUTH_SETUP_TOKEN`, then restart the API.
2. On the first visit, choose **Create first administrator**. Enter the setup token, username, password, and password confirmation. Usernames accept 3-64 letters, digits, underscores, dots, or hyphens; passwords require 12-128 characters.
3. Setup creates the administrator and signs them in. A database transaction serializes concurrent setup attempts, and a persistent setup marker prevents reopening setup even if accounts are later removed manually.
4. Open **Manage users** to create local users, assign their roles, change existing roles, or disable accounts. At least one active administrator must remain.

| Role | Browse / Download | Add / Edit Artwork | Delete Artwork | Manage Users |
| --- | --- | --- | --- | --- |
| Anonymous | Yes | No | No | No |
| Viewer | Yes | No | No | No |
| Editor | Yes | Yes | No | No |
| Administrator | Yes | Yes | Yes | Yes |

PostgreSQL tables `gallery_users`, `gallery_roles`, `gallery_role_permissions`, and `gallery_auth_state` are created automatically. Each user has one role; roles link to `artwork:write`, `artwork:delete`, and `users:manage` permissions. Passwords are stored as salted scrypt hashes, never plaintext. The UI offers the three built-in roles; arbitrary custom role/permission editing is not included.

HTTP-only, SameSite=Strict cookies identify users, but permissions and account status are read from the database on every protected request. Role or activation changes revoke that user's existing sessions, including the current session when changing your own account. Logout revokes all sessions for that account. Login and setup are limited to 10 attempts per IP per 15 minutes per server process. Use a shared gateway limiter for multi-instance deployments; behind a reverse proxy the limiter conservatively shares the proxy IP unless trusted proxy handling is configured.

Mutation requests require the `X-Gallery-Request: 1` header. The app does not enable cross-origin API access; use the same-origin frontend or Vite proxy. Serve public deployments over HTTPS with `AUTH_COOKIE_SECURE=true`.

**Migration:** `ADMIN_USERNAME` and `ADMIN_PASSWORD` are no longer used or imported. Existing artwork remains unchanged. Previous environment-based admin cookies become invalid; create the initial database administrator using the setup UI. Removing `AUTH_SETUP_TOKEN` after setup is optional; the setup endpoint remains closed.

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

## Docker

Docker Compose runs two Linux containers: the Node container serves the production-built frontend and Express API over HTTP, and PostgreSQL 18 stores artwork in a persistent named volume. This setup does not terminate TLS.

1. Copy `.env.example` to `.env` and set `PGPASSWORD` to a non-placeholder value. Configure `ARTWORK_AUTHOR` and other settings as needed.
2. Build and start the container:

	```sh
	docker compose up --build -d
	```

3. Open the frontend over HTTP at `http://localhost:8080`; the API is also available at `http://localhost:5001`. Follow logs with `docker compose logs -f gallery db`.

Stop both containers with `docker compose down`; the database volume remains. To also erase the database, run `docker compose down -v`.

For public deployment, place the application behind an HTTPS-terminating reverse proxy provided by your hosting platform or network and set `AUTH_COOKIE_SECURE=true`. Configure `AUTH_SECRET` and `AUTH_SETUP_TOKEN` before starting Compose; initialize the first administrator through the UI.

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
| `POST` | `/api/drawings` | Upload up to five images atomically. Requires editor or admin. |
| `PUT` | `/api/drawings/:id` | Update metadata and optional image. Requires editor or admin. |
| `DELETE` | `/api/drawings/:id` | Permanently delete a drawing and image. Requires admin. |
| `GET` | `/api/auth/session` | Return authentication status, user permissions, and `setupRequired`. |
| `POST` | `/api/auth/setup` | One-time bootstrap: `{username, password, setupToken}`. Creates and signs in the initial admin. |
| `POST` | `/api/auth/login` | Sign in with `{username, password}`. |
| `POST` | `/api/auth/logout` | Revoke the account's sessions and clear the cookie. |
| `GET` | `/api/roles` | List roles and permissions. Admin only. |
| `GET` | `/api/users` | List users without password hashes. Admin only. |
| `POST` | `/api/users` | Create `{username, password, role}`. Admin only. |
| `PATCH` | `/api/users/:id` | Set `{role, active}` and revoke existing sessions. Admin only. |

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

Run `npm test` for metadata and password validation tests. `npm run build` validates the frontend build; `node --check server.js` checks backend syntax.

Database auth integration tests require configured PostgreSQL credentials and permission to create a temporary schema. They use an isolated schema and remove it after testing, without modifying gallery accounts or artwork. In PowerShell:

```powershell
$env:AUTH_DATABASE_TESTS = '1'
node --test test/auth.test.js
Remove-Item Env:AUTH_DATABASE_TESTS
```