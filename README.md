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
| `RATE_LIMIT` | no | The global API rate limit (300 requests / 15 min per IP) is off by default; set `on` to enable it. The limiter on the e-mail/code endpoints is always active |
| `TRUST_PROXY` | no | Number of trusted proxies in front of the app (default `1`, which fits Railway; use `2` when Cloudflare is also in front). Needed so the rate limiter sees the real client IP |
| `RESEND_API_KEY` / `MAIL_FROM` | for e-mail verification | [Resend](https://resend.com) API key and sender (`Zenkai <no-reply@yourdomain.com>`, on a domain verified in Resend). **Without both, sign-up works as before, with no e-mail check** |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | for profile photos | [Cloudinary](https://cloudinary.com) credentials. Photos go to the `zenkai/avatars` folder. Without them, uploading a photo answers `501` |
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
| `/api/v1/auth` | public | register, verify (+ resend), recovery (+ reset), login, logout, refresh, validate |
| `/api/v1/public` | public (optional session) | catalog, anime pages, episodes, config, languages |
| `/api/v1/me` | session required | account, profile, watchlist, favorites, watch history |
| `/api/v1/admin/anime` | authority >= 30000 (moderator) | catalog, episodes, sources, audio, subtitles, segments |
| `/api/v1/admin/{accounts,app,jobs}` | authority >= 40000 (admin) | accounts, config, logs, jobs |

`GET /api/v1/public/anime/:malId/episodes/:number` accepts an optional session: when
the caller is logged in the response includes their `history`
(`progress`, `duration`, `completed`) so the player can resume and mark episodes as
watched. Guests get the plain episode.

## E-mail verification

With `RESEND_API_KEY` and `MAIL_FROM` set, creating an account confirms the e-mail with a code:

1. `POST /auth/register` creates the account as `pending` (no session yet) and e-mails a 6-digit code →
   `{ verify: true, email, sent, wait }`. Registering again with the same pending e-mail updates the
   account and sends a new code; pending accounts older than 24 h are purged so they free their username.
2. `POST /auth/verify { email, code }` activates the account, sets `verified` and opens the session.
3. `POST /auth/verify/resend { email }` sends another code. It answers the same whether or not the
   account exists, so it cannot be used to find out who is registered.
4. `POST /auth/login` with correct credentials on a still-pending account sends a fresh code and
   answers `403 { verify: true, email }`, so the frontend can continue from the code screen.

Codes: random (`crypto`), valid 15 minutes, stored only as an HMAC, one active code per account,
at most one e-mail per minute and account, 5 attempts per code, compared in constant time. These routes
also have their own rate limit (20 per 15 min per IP, `AUTH_MAIL_LIMIT`). Accounts created before this
feature are `active` and unaffected. If Resend is down the account stays pending and the code screen
offers "resend".

### Password recovery

Same codes, different `purpose` (`recovery`), so the code from a sign-up e-mail never works here:

1. `POST /auth/recovery { email }` e-mails a code to an **active** account (pending ones must verify first,
   suspended ones are skipped). It always answers `200` with a constant `wait`, whether the account exists or not.
   Without Resend configured it answers `501` (not `503`: the frontend logs out on 503).
2. `POST /auth/recovery/reset { email, code, password }` checks the code, sets the new password, **drops every
   open session** and does not log in: the user goes back to the login screen.

## Profile photos (Cloudinary)

`POST /me/profile/avatar` (multipart, field `avatar`: JPEG, PNG or WebP, up to 5 MB) uploads the photo to Cloudinary under
the project's root folder `zenkai/avatars`, stores its URL in `profile.avatar` and deletes the previous photo. `DELETE
/me/profile/avatar` removes it. The file type is checked from its first bytes, not from what the browser declares; the
image is stored at 512 px at most. Only images in our own Cloudinary account and `zenkai/` folder are ever deleted, so an
older avatar hosted elsewhere is left alone. `avatar` is no longer accepted in `PATCH /me/profile`: a photo can only come
from the upload. The frontend crops the image to a square (`react-easy-crop`) before sending it.

## Sources, audio and subtitles

Each episode has **sources** (`anime.anime_sources`) and **subtitle tracks**
(`anime.anime_subtitles`). Both are added from the admin panel or the admin API:

| Endpoint (under `/api/v1/admin/anime`) | Purpose |
| --- | --- |
| `POST /episodes/:id/sources` | `{ server, url, type: hls\|mp4\|embed, quality, language }` |
| `DELETE /sources/:id` | Remove a source |
| `POST /episodes/:id/subtitles` | `{ language, label, url, default }` — a WebVTT (`.vtt`) file already hosted somewhere |
| `POST /episodes/:id/subtitles/upload?language=&label=&filename=&default=` | The body is the subtitle file itself (`application/octet-stream`, up to 5 MB): `.ass`, `.ssa`, `.srt` or `.vtt` |
| `POST /episodes/:id/audio-uploads` | `{ filename, size, language, offset, track }` — queue an extra audio (`track` = which audio track of the file to use, counting from 1; omitted → the one matching `language` by tag/title, e.g. "Latino", else the first) (another dub) for an episode already published as HLS; returns a signed URL to upload it, then call `POST /uploads/:id/complete` |
| `PATCH /episodes/:id/audio/:dir` | `{ name }` — set the name an audio track is shown with (`Español latino`); up to 40 characters, unique within the episode; an empty name goes back to the language's name. Only the manifest changes |
| `PATCH /subtitles/:id` | `{ label?, language?, default? }` — edit how a subtitle track is shown (up to 60 characters), its language code (unique per episode) or make it the default (only one per episode). The `.vtt` file is not touched |
| `DELETE /subtitles/:id` | Remove a subtitle track |
| `PUT /episodes/:id/segments/:type` | `{ start, end }` in seconds — set an intro / outro / recap by hand (`type` = `intro`, `outro` or `recap`); manual always wins |
| `DELETE /episodes/:id/segments/:type` | Remove a segment |
| `POST /episodes/:id/segments/fetch` | Look the episode's segments up in AniSkip → `{ found, saved, kept }` |
| `POST /:id/segments/fetch` | Same for every episode of the anime, in the background (`202`) |

The model follows how large platforms work: **one video, many tracks**.

- **Audio languages and qualities** travel inside an **HLS manifest** (`type: hls`):
  one `master.m3u8` lists the video renditions and one `EXT-X-MEDIA:TYPE=AUDIO`
  entry per language. The player lets the user switch audio and quality without
  loading another video, so a dub is an extra audio track, not another source.
- **Qualities are generated on publish, from the source downwards.** Upload one file at its best quality
  and the pipeline produces the original height plus every step of 1080p / 720p / 480p that is clearly
  below it (never upscaling): a 4K file gives 2160p + 1080p + 720p + 480p, a 1080p file gives 1080p + 720p +
  480p, a 720p file gives 720p + 480p. Each rendition is capped (about 16 / 6 / 3.5 / 1.6 Mbps) and they all
  share a keyframe every 2 s, so the player switches between them without a hiccup. With several renditions
  all of them are re-encoded; a file that already is one small browser-safe H.264 is still copied as is.
  Roughly 1.5 GB per 24-minute episode for the 1080p ladder, and the processing takes longer than before.
  Episodes published earlier keep their single quality.
- **Subtitles** are separate WebVTT files, one per language, independent from the
  sources: the same track works with any quality or server of the episode.
  Subtitle renditions declared in the HLS manifest also show up in the player menu.
  - **Uploading a subtitle file** (`.ass`, `.ssa`, `.srt` or `.vtt`) from the admin goes through
    `subtitles/upload`: the API converts it to WebVTT with plain JavaScript (no ffmpeg needed,
    see `utils/subtitle.util.js`), stores it at `anime/<malId>/<episode>/subs/<lang>.vtt` in the
    public bucket and registers it. Uploading another one for the same language replaces it.
  - The file is read as raw bytes and its encoding is detected (UTF-8, UTF-8/UTF-16 with BOM,
    or Windows-1252), so old `.srt`/`.ass` files keep their accents.
  - From an `.ass` the text and the timing are kept; the **styling is not** (colours, position,
    karaoke) and vector drawings and `Comment:` lines are dropped. Overlapping duplicate lines
    (typical of karaoke) are merged into one.
  - The API service needs the same storage variables as the worker for this (`R2_ACCOUNT_ID`,
    `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`); without them the
    endpoint answers `503`. Re-uploading the *video* replaces the episode's folder, subtitles included.
- `mp4` and `embed` sources still work. `mp4` supports subtitles; `embed` is an
  iframe, so there is no progress tracking or track selection.

Files are hosted wherever you upload them; the API only stores URLs. The host must
send CORS headers (`Access-Control-Allow-Origin`) for the manifest, its segments and
the `.vtt` files, otherwise the browser will not load them.

### Uploading from the admin panel

In **Admin → Catalog → anime**, each episode has an **↑ Upload video** button (you can
also drop the files straight onto the episode row). Drop the video and, optionally, its
subtitles and extra audio tracks (`ep01.es.srt`, `ep01.es.m4a`: the language is taken
from the file name, or typed in). There are no folders to create: the destination
`anime/<malId>/<episode>/` is derived from the episode.

**Several episodes at once:** the episodes page has an **↑ Subir varios** button. Drop all the files (videos,
subtitles and audio tracks): each one is assigned to the episode its name says (`01.mkv`, `Serie - 05 [1080p].mkv`,
`[Group] Serie - 05 (BD).mkv`, `S01E05`, `05.es.srt`, `05.lat.m4a`…), and you can fix the number or the language
before starting.

- An episode **with a video** is uploaded whole (its subtitles and audios travel in the same job).
- An episode **without a video** adds its subtitles and audios to the video it already has: subtitles are saved
  right away (`subtitles/upload`, labelled with the language without region), and an audio goes through
  `audio-uploads` and is added by the worker. An audio needs the episode to be already published as HLS, and only
  **one audio per episode per batch** fits, because an episode takes one conversion job at a time; the other one goes
  in the next batch.

Problems are flagged per episode (no number, the episode does not exist, more than one video, two subtitles in the
same language, audio without a published video, an upload already running) and block the start; episodes that
already have a video are marked as *replaces*. Episodes are uploaded one after another with the same calls as the
individual uploads, so there is no new endpoint; a failed episode does not stop the rest and can be retried.

```
browser ──PUT (signed URL)──▶ incoming/<token>/ ──▶ worker ──▶ anime/<malId>/<episode>/ (HLS)
   │                                 ▲                │            (all in the same bucket)
   └── API: create / complete ───────┴── queue ───────┘   (table anime.anime_uploads)
```

1. `POST /api/v1/admin/anime/episodes/:id/uploads` validates the request, creates the job
   and returns one **signed URL per file**. The browser uploads straight to the bucket
   (under `incoming/<random token>/`), so large videos never go through the API (one file
   up to 50 GB; from 1 GB on the file is sent as a **multipart upload**: the API returns one signed URL
   per 128 MB part, the browser sends 4 at a time and retries each part up to 3 times).
2. `POST /uploads/:id/complete` closes the multipart uploads (lists their parts and completes them),
   checks that every file arrived with its announced size and queues the job. Discarding an
   unfinished upload aborts its multipart upload. Note that the worker downloads the whole
   original to its disk to convert it, so very large files need that much free space there.
3. The **worker** (`npm run worker`) takes queued jobs, downloads the originals, runs the
   same conversion as `publish:episode`, publishes, registers the source and subtitles,
   and deletes the originals. The episode row shows *En cola → Convirtiendo → Publicado*
   (or the error, with **Reintentar** and **Descartar**). `POST /uploads/:id/retry` and
   `DELETE /uploads/:id` back those buttons.

Setup:

1. **Hide `incoming/` on the public domain.** The bucket is public through its custom
   domain, so the original uploads would be downloadable from `/incoming/...` while they
   wait for conversion. Their path carries a random token (not guessable), but also block
   it: in Cloudflare, **Security → WAF → Custom rules**, create a rule that blocks
   ```
   (http.host eq "cdn.your-domain.com" and starts_with(http.request.uri.path, "/incoming/"))
   ```
   Signed uploads and the worker use the S3 endpoint, not the custom domain, so the rule
   does not affect them. (To keep the originals in a separate private bucket instead, set
   `R2_UPLOAD_BUCKET`; then this rule is not needed.)
2. **CORS on the bucket**: add `PUT` so the browser can upload from the admin. A single rule
   covers the player too:
   ```json
   [{"AllowedOrigins":["https://your-frontend.example.com"],"AllowedMethods":["GET","HEAD","PUT"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
   ```
3. **API service on Railway:** add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`. (Without them the upload endpoint answers
   `503 Uploads are not configured`.)
4. **Worker service on Railway:** create a second service from this same repository and set
   `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker` (the image is the API plus ffmpeg). Give it
   the database variables (`DB_*`) and all the `R2_*` ones (`R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`) and nothing
   else; it exposes no port.

Notes: run **one** worker instance. A job interrupted by a restart goes back to the queue
by itself. The worker needs disk for the original plus the converted copy (roughly two to
three times the video size). Abandoned uploads and old errors are cleaned up hourly.

### Publishing an episode (`npm run publish:episode`)

Converts a video to HLS with ffmpeg (one rendition, one audio track per language),
converts subtitles to WebVTT, uploads everything to Cloudflare R2 and registers the
source and subtitles in the database. Running it again on the same episode replaces
what was there instead of duplicating it.

```bash
npm run publish:episode -- --anime 52991 --episode 1 --video ./ep01.mkv \
    --audio-lang ja --audio es=./ep01.es.m4a \
    --sub es=./ep01.es.srt --sub en=./ep01.en.ass
```

| Option | Meaning |
| --- | --- |
| `--anime` / `--episode` | MyAnimeList id and episode number (the episode must already exist: sync its list first) |
| `--video` | Video file; its first audio track is the main one |
| `--audio-lang` | Language of that main audio (default `ja`) |
| `--audio L=FILE` | Extra audio track, e.g. a dub (repeatable) |
| `--sub L=FILE` | Subtitles in `.srt`, `.ass` or `.vtt` (repeatable) |
| `--default-sub` | Language shown by default (the first one if omitted) |
| `--server` / `--language` | Name shown in the server picker (default `Zenkai`) and `sub`/`dub` label |
| `--reencode` | Re-encode the video even if it is already browser-compatible |
| `--dry-run` | Convert and print the plan without uploading or touching the database |
| `--keep` | Keep the temporary files |

The audio tracks and text subtitle tracks already inside the video (an `.mkv`, for
example) are used automatically, mapped by their language tag. Loose `--audio` and
`--sub` files are added on top, and a loose subtitle wins over an embedded one in the
same language. Image-based subtitles (PGS, DVD) cannot be converted and are skipped.
Spanish is the default subtitle when present, otherwise the first one.

### Who can watch

The site is public; the player is not. `GET /public/anime/:malId/episodes/:number` answers a guest with the episode's
data (title, thumbnail, duration…) and `locked: true`, but **no sources, subtitles or segments**. The frontend then shows
a "log in to watch" screen and, after logging in or signing up, comes back to that episode. Note that the HLS files
themselves sit on a public bucket: hiding the URLs in the API stops casual access, but anyone who already knows a
`master.m3u8` URL can still open it. Real protection would need signed URLs or Cloudflare Access in front of the bucket.

### Episode thumbnails

The episode list shows a thumbnail per episode. Where it comes from, best first:

1. **A frame of the video itself**, taken at 25 % of its duration (640 px wide) when the episode is published
   (`anime/<malId>/<ep>/thumb.jpg`). For episodes published earlier: `npm run generate:thumbnails`
   (`-- --anime 52991 [--episode 3] [--force]`); it reads the published HLS, no original file needed.
2. **Kitsu's thumbnail**, fetched on demand the first time someone opens an anime's episode list that has episodes
   without one (`anime.thumbnailsSyncedAt` records when; retried after 30 days). It never overwrites a thumbnail of
   our own.
3. Otherwise the card falls back to the blurred series cover.

### Subtitle appearance

Size (50–200 %), background opacity (0–100 %), text colour (`#rrggbb`) and font (`default`, `sans`, `serif`,
`mono`, `casual`) live in the profile: `PATCH /me/profile` with `{ "preferences": { "subtitles": { size, opacity, color,
font } } }`. `preferences` is validated key by key (anything unknown is dropped, an out-of-range value answers `406`) and
merged with what the profile already has, so sending only `subtitles` does not wipe `autoplay` or the rest. The settings
follow the account across devices; the frontend edits them in Settings → Player.

### Language preference in the player

The player picks the audio and subtitles in this order: what the user chose by hand last time, then the profile
language (`profile.language`; `es` also matches `es-419` and the other way round) and finally the track the manifest or the
admin marks as default. Subtitles stay off if the user turned them off. Saving a different profile language forgets the
manual choice so the new one takes effect.

### Skip intro / credits / recap

Each episode can have **segments** (`anime.anime_segments`: `type`, `start`, `end` in seconds,
`source`, `confidence`). The player shows a **Skip intro** / **Skip recap** / **Next episode**
(credits) button while the playback is inside one, draws them on the progress bar and has a
"skip intros automatically" setting. The public episode endpoint returns them as `segments`.

Where they come from, in priority order (a lower source never overwrites a higher one):

1. `manual` — set by an admin (episode panel → *Marcas*).
2. `aniskip` — community timestamps from [AniSkip](https://api.aniskip.com), looked up by MyAnimeList id
   and episode number. It runs automatically when an episode is published, from the admin
   (*Buscar en AniSkip*, per episode, or *Buscar marcas*, per anime) and with
   `npm run fetch:segments` for what is already published:

   ```bash
   npm run fetch:segments                          # every episode that has a video
   npm run fetch:segments -- --anime 52991         # one anime
   npm run fetch:segments -- --anime 52991 --episode 3
   ```

   AniSkip times belong to one specific cut of the video, so the entry whose `episodeLength` is
   closest to the real duration is used, and none at all if it differs by more than 2 minutes.
   `confidence` records how close it was. Review (or correct by hand) what looks off.
3. `detected` — reserved for a future automatic detection that compares the audio of consecutive
   episodes in the worker.

### Adding another audio (dub) to a published episode

No need to upload the video again: only the new audio is converted and added to the
episode's `master.m3u8`. From the admin, use **⋯ → Añadir audio (doblaje)** on the episode,
or from the terminal:

```bash
npm run add:audio -- --anime 52991 --episode 1 --audio es-419=./latin-dub.m4a
npm run add:audio -- --anime 52991 --episode 1 --audio es=./dub.m4a --offset -300
```

- The file can be an audio file or a video/mkv (its first audio track is used).
- Use a region code to tell dubs apart: `es`, `es-419`, `es-ES`…
- If the episode already has an audio in that language it is **replaced**. The new one goes
  to a new folder (segments are cached as immutable) and the old one is deleted.
- `--offset` (ms) fixes a dub that is out of sync: positive delays it, negative advances it.
  A warning is shown when the audio length differs from the video by more than 2 s.
- The episode must have been published as HLS by this project (`publish:episode`, `publish:folder`
  or the admin upload).

### Publishing a whole folder (`npm run publish:folder`)

Drop the videos in a folder and let the script do the rest: convert, upload to the
episode's folder in the bucket and register it.

```bash
npm run publish:folder -- ./episodes            # process once
npm run publish:folder -- ./episodes --watch    # keep watching, publish what you drop in
```

```
episodes/
  52991/                ← MyAnimeList id of the anime
    01.mkv              ← episode number (01, 1, 001…)
    01.es.srt           ← loose subtitles: NUMBER.LANG.srt|ass|vtt
    01.es.m4a           ← loose audio (a dub): NUMBER.LANG.m4a|aac|mka|mp3…
    02.mp4
```

- What was already published is remembered in `episodes/.zenkai-published.json` and is
  not repeated unless the video or its loose files change (or you pass `--force`).
- A file modified in the last 15 seconds is skipped, because it is probably still being
  copied; `--watch` picks it up on the next check (`--interval`, 30 s by default).
- An episode that fails (for example, it does not exist in the database yet) does not
  stop the rest, and `--watch` retries it after 10 minutes or when the file changes.
- Publishing an episode again replaces its folder in the bucket, so segments from the
  previous version do not pile up. Each episode has a single HLS package.
- The other options (`--server`, `--language`, `--audio-lang`, `--reencode`,
  `--dry-run`) work as in `publish:episode`.

Requirements:
- **ffmpeg** in the `PATH` (Windows: `winget install Gyan.FFmpeg`), or its path in `FFMPEG_PATH`.
- In `.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and
  `R2_PUBLIC_URL` (the bucket's public URL, no trailing slash). `R2_ENDPOINT` points the
  upload at another S3-compatible service instead.
- The bucket needs public read access and a CORS rule that allows `GET` and `HEAD` from
  the frontend's origin.

H.264 8-bit video is copied without re-encoding; anything else is re-encoded to H.264,
which takes much longer. Files land under `anime/<malId>/<episode>/`. To publish to
production, run it with the production database credentials (for example
`railway run npm run publish:episode -- ...` using the database's public URL).

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
