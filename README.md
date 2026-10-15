# TAC PROTOCOL

Telegram Mini App — cloud mining on TON with real verification and referrals.

## Official task links (built-in defaults)
- Telegram 1: https://t.me/tacprotocolxnvdax (`@tacprotocolxnvdax`)
- Telegram 2: https://t.me/onlylegit_official (`@onlylegit_official`)
- YouTube: https://youtube.com/@rajtilakeditz

## Features
- Mining + neon logo, TON Connect, levels, withdrawals queue
- **0.2 TON** on-chain verification (TonAPI) + blue **Verified ✓** badge
- Referrals with invite list (name, ID, join date, tasks, verification)
- Telegram membership via Bot API `getChatMember`
- YouTube: open channel; no fake “subscribed” without Google OAuth (optional honor system)
- In-app Admin (server-side `ADMIN_TELEGRAM_IDS` only)

## Environment (Render)
```
ADMIN_TELEGRAM_IDS=YOUR_NUMERIC_ID
BOT_TOKEN=from_BotFather
BOT_USERNAME=YourBotUsername
APP_URL=https://your-service.onrender.com
TONAPI_KEY=optional
```

**Bot setup for Telegram Verify:** add the bot as **admin** on both channels.

**Payment verify:** Admin → set **treasury address**. Users send exactly **0.2 TON** from their connected wallet, then tap Verify.

## Deploy
1. Push this project to GitHub  
2. Render Web Service: build `npm install`, start `node server/index.js`  
3. Set env vars → Deploy  
4. BotFather Mini App URL = your HTTPS URL  
