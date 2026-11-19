# Zenkai — Backend

REST API for the Zenkai anime streaming platform. Node.js + Express + Sequelize
(PostgreSQL), with Redis for caching, rate limiting and job locks.

The anime catalog is **mirrored into Postgres** from the official MyAnimeList API
(plus [Jikan](https://docs.api.jikan.moe) for the data MAL does not expose), so
public requests never hit an upstream API.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the credentials
npm start              # nodemon server.js
```

On boot the server authenticates against the database, creates the schemas
(`anime`, `accounts`, `app`, `library`), runs the idempotent migrations, seeds the
base data (roles, config, languages, genres) and starts the scheduler. If the
catalog has never been fully synced, it also kicks off the initial sync in the
background (see [Catalog sync](#catalog-sync)).

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DB_DIALECT` | yes | `postgres` |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_DATABASE` | yes | PostgreSQL connection |
| `FRONTEND_DOMAIN` | yes | **Public** URL of the frontend, with protocol (e.g. `https://zenkai.example.com`). Used only by CORS |
| `NODE_ENV` | yes | `development` or `production`. Production enables `secure` + `sameSite=none` cookies |
| `PORT` | no | HTTP port (default `3010`; Railway injects it) |
| `JWT_SECRET_SEED` | yes | Secret used to sign tokens |
| `JWT_EXPIRE_IN` / `JWT_REFRESH_EXPIRE_IN` | no | Access / refresh lifetime (`15m` / `30d`) |
| `MAL_CLIENT_ID` | yes for sync | Client ID of a MyAnimeList app ([myanimelist.net/apiconfig](https://myanimelist.net/apiconfig), free) |
| `JIKAN_BASE_URL` / `JIKAN_CACHE_TTL` | no | Jikan endpoint and cache TTL in seconds |
| `REDIS_URL` | recommended | Redis connection URL (default `redis://localhost:6379`) |
| `TRUST_PROXY` | no | Number of trusted proxies in front of the app (default `1`, which fits Railway; use `2` when Cloudflare is also in front). Needed so the rate limiter sees the real client IP |
| `SYNC_ON_BOOT` | no | Set to `false` to disable the initial catalog sync on startup |

## Project structure

```
app.js            Express, CORS, helmet, rate limit and /api/v1 mounting
server.js         Boot: DB auth, schemas, sync, migrations, seeders, scheduler
cors/             Allowed-origins policy (derived from FRONTEND_DOMAIN)
database/         Connection, schema creation and idempotent migrations
models/           Sequelize models per domain + init.models.js (associations)
seeders/          Base data (roles, config, languages, genres) + data/
routes/           Routers per group: auth, public, user (/me), admin
middlewares/      Validation and resource loading, same tree as routes/
controllers/      HTTP responses, same tree as routes/
services/         Integrations: jikan, catalog (mirror), redis, auth, logger
scheduler/        Cron jobs and their handlers
scripts/          One-off tasks (catalog backfill, episode lists)
utils/            Pure helpers (appError, catchAsync, jwt, hash, pagination)
```

A request always follows the same flow:
`routes -> middlewares (validate and load into req) -> controllers (respond)`.

## API groups

| Prefix | Access | Contents |
| --- | --- | --- |
| `/api/v1/auth` | public | register, login, logout, refresh, validate |
| `/api/v1/public` | public (optional session) | catalog, anime pages, episodes, config, languages |
| `/api/v1/me` | session required | account, profile, watchlist, favorites, watch history |
| `/api/v1/admin` | authority >= 30000 | accounts, catalog, episodes, sources, jobs, logs |

`GET /api/v1/public/anime/:malId/episodes/:number` accepts an optional session: when
the caller is logged in the response includes their `history`
(`progress`, `duration`, `completed`) so the player can resume and mark episodes as
watched. Guests get the plain episode.

## Sources, audio and subtitles

Each episode has **sources** (`anime.anime_sources`) and **subtitle tracks**
(`anime.anime_subtitles`). Both are added from the admin panel or the admin API:

| Endpoint (under `/api/v1/admin/anime`) | Purpose |
| --- | --- |
| `POST /episodes/:id/sources` | `{ server, url, type: hls\|mp4\|embed, quality, language }` |
| `DELETE /sources/:id` | Remove a source |
| `POST /episodes/:id/subtitles` | `{ language, label, url, default }` — a WebVTT (`.vtt`) file |
| `DELETE /subtitles/:id` | Remove a subtitle track |

The model follows how large platforms work: **one video, many tracks**.

- **Audio languages and qualities** travel inside an **HLS manifest** (`type: hls`):
  one `master.m3u8` lists the video renditions and one `EXT-X-MEDIA:TYPE=AUDIO`
  entry per language. The player lets the user switch audio and quality without
  loading another video, so a dub is an extra audio track, not another source.
- **Subtitles** are separate WebVTT files, one per language, independent from the
  sources: the same track works with any quality or server of the episode.
  Subtitle renditions declared in the HLS manifest also show up in the player menu.
- `mp4` and `embed` sources still work. `mp4` supports subtitles; `embed` is an
  iframe, so there is no progress tracking or track selection.

Files are hosted wherever you upload them; the API only stores URLs. The host must
send CORS headers (`Access-Control-Allow-Origin`) for the manifest, its segments and
the `.vtt` files, otherwise the browser will not load them.

## Catalog sync

The public catalog is served from Postgres. The upstream APIs only feed the mirror.

```bash
npm run sync:catalog             # full backfill (~30,000 titles)
npm run sync:catalog -- 50       # only 50 pages (1,250 titles)
npm run sync:catalog -- 50 mal   # force a source
npm run sync:episodes            # episode lists for the 100 most popular titles
npm run sync:episodes -- 500     # ... or 500 titles
npm run sync:episodes -- all     # every title that is still pending
```

On a fresh deployment you do not need to run anything by hand: if the backfill has
not finished, the server launches `catalog:full-sync` in the background right after
starting (a redeploy does nothing once it is done). Set `SYNC_ON_BOOT=false` to
opt out. Without `MAL_CLIENT_ID` the job fails and is retried on the next boot.

### Data sources

| Data | Source | Why |
| --- | --- | --- |
| Catalog, details, metrics, seasons | Official MAL API | Authoritative and fast (500 entries per request) |
| Recommendations and related titles | Official MAL API | Included in the detail response |
| **Episode lists** | **Jikan**, with **Kitsu** as fallback | `/anime/{id}/episodes` is not available on the official API. If Jikan is down (network error, 429 or 5xx) the sync switches to Kitsu for 10 minutes; Kitsu gives number, title and air date but no filler/recap flags, so it never overwrites those |
| Characters | Jikan | The official API ignores the `characters` field |
| Video links | none | No API provides them; they are added through the admin panel |

Everything is stored by `mal_id` with upserts, so re-syncing never duplicates rows
and never overwrites what the admin panel manages (`featured`, `visible`, banner).
A failed page does not abort the run: it is recorded in `failedPages`, the sync
continues and the pages are retried at the end. It only aborts after 15 consecutive
failures. The sync is **resumable**: the cursor lives in `anime.anime_sync_state`.

### Scheduled jobs

All times are UTC.

| Job | When | What it does |
| --- | --- | --- |
| `catalog:refresh` | daily, 05:00 | Score, members and episodes for airing, upcoming and top titles |
| `catalog:airing-episodes` | every 6 hours | New episodes of airing series, 80 per batch, oldest-checked first |
| `catalog:full-sync` | Sundays, 03:00 | Full catalog sweep (under a minute with the official API) |
| `catalog:backfill` | every hour | Continues an unfinished sweep; no-op when complete |
| `catalog:episodes` | every hour (:30) | Episode lists (number, title, air date, filler/recap) for up to 2,000 titles per run that do not have them yet, most popular first; no-op when none are left. Jikan's quota (~50 requests/min) is the real limit, so the whole library takes a day or two |

Each run is recorded in `anime.anime_sync_state` (row `job:<name>`: status, start,
end, result) and can be viewed and triggered from **Admin → Jobs**
(`GET /api/v1/admin/jobs`, `POST /api/v1/admin/jobs/:name/run`; the latter requires
authority >= 40000). With several API instances each job takes a Redis lock
(`lock:<name>`) so it never runs twice; `full-sync` and `backfill` share one lock
because they walk the same cursor. If Redis is down, jobs fall back to in-process
control instead of stopping.

## Design notes

- **Jikan only provides metadata.** It has no video: playable links live in
  `anime.anime_sources`, one per server/language/quality. Being in the catalog does
  not mean being watchable — the `available` flag tells apart the ~29,000 MAL
  entries from the titles that actually have episodes with sources.
- **Shared Jikan queue across processes** (`services/modules/jikan.service.js`).
  It respects both of Jikan's limits: 400 ms between calls (3 req/s) **and** a
  sliding window of 50 per minute. The permit is requested from Redis with a Lua
  script because the limit is per IP: the API and the sync scripts share the quota.
  If Redis is down it falls back to a local limiter. A 429 opens a shared 60 s
  cooldown. The cache keeps responses for 7 days and serves the stale copy if the
  upstream fails.
- **Redis is optional at runtime.** Cache reads fail fast and behave as a miss
  (`enableOfflineQueue: false`, 1 s command timeout), so a dead Redis degrades the
  API instead of hanging it.
- **httpOnly cookie authentication** (`zk_access` / `zk_refresh`) with refresh
  rotation on every use and per-session revocation in the database.
- **Numeric `authority`** instead of a string role: permissions are a single
  comparison (`>= 30000` staff, `>= 40000` admin).

## Deploying on Railway

1. Add a **PostgreSQL** and a **Redis** service to the project.
2. In the backend service variables, reference them:
   `REDIS_URL=${{Redis.REDIS_URL}}` (private network) and the `DB_*` values from
   the Postgres service.
3. Set `NODE_ENV=production`, `JWT_SECRET_SEED`, `MAL_CLIENT_ID` and
   `FRONTEND_DOMAIN` (the frontend's **public** URL with `https://`; browsers send
   that origin, not the private `*.railway.internal` one).
4. Check the boot logs for `DATABASE STATUS SYNC`, `REDIS STATUS CONNECTED` and
   `SCHEDULER STATUS ... JOBS SCHEDULED`.
