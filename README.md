# TAC PROTOCOL — Telegram Mini App

Cloud mining Mini App on TON with full Admin Panel.

## Features
- Mining dashboard, levels by holdings, claim rewards
- Daily check-in + social tasks
- Referrals (bonus + lifetime commission)
- Vault / TON wallet connection + verification settings
- Withdrawal queue (admin processes on-chain manually — no auto-send)
- Admin panel at `/admin` (Telegram ID whitelist only)

## Local run
```bash
npm install
export ADMIN_TELEGRAM_IDS=YOUR_TELEGRAM_NUMERIC_ID
npm start
```
- App: http://localhost:3000  
- Admin: http://localhost:3000/admin  

Get your ID from @userinfobot on Telegram.

## Deploy on Render (from Android phone)

### 1. Prepare
- Install **GitHub** app or use browser → github.com
- Create a new **private** repository (e.g. `tac-protocol`)
- Upload this project folder (or push the ZIP contents)

### 2. On Render.com (browser on phone)
1. Go to [https://render.com](https://render.com) → Sign up with GitHub
2. **New +** → **Web Service**
3. Connect your `tac-protocol` repo
4. Settings:
   - **Name:** tac-protocol
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server/index.js`
   - **Instance:** Free
5. **Environment** → Add:
   - Key: `ADMIN_TELEGRAM_IDS`  
     Value: `123456789`  ← your Telegram numeric ID
   - (Optional) `BOT_TOKEN` from @BotFather
6. Click **Create Web Service**
7. Wait for deploy → copy your URL: `https://tac-protocol-xxxx.onrender.com`

### 3. Connect to Telegram
1. Open @BotFather → `/newbot` (or use existing bot)
2. `/newapp` → select bot → set title **TAC PROTOCOL**
3. **Web App URL** = your Render URL (e.g. `https://tac-protocol-xxxx.onrender.com`)
4. Open the Mini App link from BotFather inside Telegram

### 4. Admin access
- Open the Mini App **while logged in with the Telegram account whose ID you set**
- Bottom nav shows **Admin** shield → or open `https://your-render-url.onrender.com/admin`
- Only that Telegram ID can access admin APIs

## Important notes
- Data is stored in `server/data.json` (ephemeral on free Render — upgrades or external DB recommended for production)
- Withdrawals are **queued only**. Admin must send TAC on-chain, then paste TX hash and mark **Paid**
- Server never auto-transfers funds or fakes blockchain success
- Set multiple admins: `ADMIN_TELEGRAM_IDS=111,222,333`

## Project structure
```
tac-protocol/
  public/
    index.html      # User Mini App
    admin.html      # Admin Panel
  server/
    index.js        # API + admin routes
    db.js           # JSON store + settings
  package.json
  render.yaml
  README.md
```
