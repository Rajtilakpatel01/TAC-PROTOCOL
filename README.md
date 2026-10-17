# TAC PROTOCOL — Telegram Mini App

## Database (PostgreSQL on Render)

Set **`DATABASE_URL`** from a Render PostgreSQL instance.  
Until you add it, the app uses a **JSON file fallback** (not durable without a disk).

### Render setup

1. Render Dashboard → **New** → **PostgreSQL** (or existing DB)  
2. Copy **Internal Database URL**  
3. Web service → **Environment** → add:
   ```text
   DATABASE_URL=postgres://...
   ```
4. Redeploy web service  
5. Logs should show: `[db] backend=PostgreSQL` and `[boot] database mode= postgres`

### Migration from JSON

On first successful PostgreSQL connection, if `app_state` is empty, the server **imports** any existing `data.json` it can find (does not delete the file).

### Schema

See `server/schema.sql`. Table `app_state` stores the full app payload as JSONB (users, referrals, settings, treasury, payments, etc.).

### Env vars

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | **Yes for production** | PostgreSQL connection string |
| `ADMIN_TELEGRAM_IDS` | Yes | Admin Telegram numeric IDs |
| `BOT_TOKEN` | For channel tasks | BotFather token |
| `BOT_USERNAME` | For invites | Bot username without @ |
| `APP_URL` | Recommended | Public HTTPS URL |
| `TONAPI_KEY` | Optional | TonAPI |
| `TON_CENTER_API_KEY` | Optional | TON Center fallback |

`DATA_PATH` is optional when using PostgreSQL (no longer required for durability).

## Start

```bash
npm install
node server/index.js
```


# TAC PROTOCOL — Telegram Mini App

Cloud mining Mini App on **TON** with TON Connect, on-chain verification, referrals, tasks, and Admin Panel.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ADMIN_TELEGRAM_IDS` | **Yes** | Numeric Telegram ID(s) of admins |
| `BOT_TOKEN` | **Yes** for channel tasks + initData checks | BotFather token (server only) |
| `BOT_USERNAME` | **Yes** for invite links | Bot username without `@` |
| `APP_URL` | Recommended | Public HTTPS URL of this service |
| `MINI_APP_PATH` | Optional | BotFather Mini App short name (e.g. `app`) |
| `TONAPI_KEY` | Optional | [tonapi.io](https://tonapi.io) key (better rate limits) |
| `TON_CENTER_API_KEY` | Optional | [toncenter.com](https://toncenter.com) API key (fallback chain lookup) |
| `TON_CENTER_URL` | Optional | Default `https://toncenter.com/api/v2` |
| `DATA_PATH` | **Recommended on Render** | Persistent disk path, e.g. `/var/data` |

**Not configured by default:** auto on-chain *sending* of withdrawals (admin marks paid after manual transfer), Google OAuth YouTube verification.

Check live: `GET /api/config-status`

## Security

- No seed phrases or private keys ever requested
- Wallet connect via official **TON Connect UI**
- Payment verification requires blockchain confirmation (TonAPI and/or TON Center)
- Duplicate TX hashes cannot verify two accounts
- Admin routes use server-side `ADMIN_TELEGRAM_IDS`
- `BOT_TOKEN` / API keys stay in backend env only

## Features

- Mining rates configurable in Admin (`mining_base_power`, level multipliers)
- Tasks: Telegram `getChatMember` for channels; YouTube honor-system optional
- Referrals via `?startapp=ref_CODE`
- Wallet: Connect, 0.2 TON verify (configurable), withdraw *requests*
- Admin: treasury, fees, channels, users, payments, withdrawals

## Render disk (treasury & users survive redeploy)

1. Add disk mount `/var/data`
2. Set `DATA_PATH=/var/data`
3. Redeploy

## Start

```bash
npm install
node server/index.js
```


## Fix: ENOENT /var/data/data.json

This means `DATA_PATH=/var/data` is set but the folder was missing or not writable.

**Option A — Persistent Disk (recommended)**  
1. Render → Disks → create disk, mount path `/var/data`  
2. Env `DATA_PATH=/var/data`  
3. Redeploy  

**Option B — No disk**  
Remove `DATA_PATH` from env (or leave it; the app now falls back to a writable path automatically).

The app creates `data.json` on first boot if missing and **does not wipe** an existing file.
