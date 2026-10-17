# TAC PROTOCOL — Telegram Mini App

## Environment variables (Render)

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_TELEGRAM_IDS` | Yes | Your numeric Telegram user ID(s), comma-separated |
| `BOT_TOKEN` | Yes for channel tasks | BotFather token; bot must be **admin** of both channels |
| `BOT_USERNAME` | Yes for invites | Bot username without `@` |
| `APP_URL` | Recommended | `https://your-service.onrender.com` |
| `MINI_APP_PATH` | Optional | e.g. `app` if BotFather short name is `app` |
| `TONAPI_KEY` | Optional | TonAPI key for higher rate limits |
| `DATA_PATH` | **Strongly recommended** | Persistent disk mount path, e.g. `/var/data` |

## Persistent treasury & user data on Render

Free Render disks are ephemeral unless you attach a **Persistent Disk**.

1. Render Dashboard → your service → **Disks** → Add disk  
2. Mount path: `/var/data`  
3. Environment: `DATA_PATH=/var/data`  
4. Redeploy  

Without `DATA_PATH`, `data.json` lives next to the app and **can reset on redeploy**.

## Admin setup checklist

1. Open Mini App as admin → **Admin → Settings**
2. Set **Treasury address** (UQ…/EQ…) → Save  
3. Set **Channel 1/2** links + chat IDs (`@channelname`)  
4. Set **Bot username**  
5. Wallet page should show the treasury after Save (no re-login required)

## Features

- Mining dashboard, levels, claim rewards  
- Tasks: Telegram membership (Bot API) + optional YouTube honor-system  
- Friends/referrals via `startapp=ref_CODE`  
- TON Connect wallet + 0.2 TON on-chain verification  
- In-app Admin Panel (server-side `ADMIN_TELEGRAM_IDS`)  

## Keep-alive

Ping `GET /health` every 10–14 minutes (cron-job.org) to reduce free-tier cold starts.

## Deploy

```bash
npm install
node server/index.js
```

Or push to GitHub and connect Render (Node, start command `node server/index.js`).
