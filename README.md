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
