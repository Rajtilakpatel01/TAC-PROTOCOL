const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Comma-separated Telegram user IDs. Example: ADMIN_TELEGRAM_IDS=123456789,987654321
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Lightweight keep-alive / health (for cron-job.org etc. — prevents Render free-tier sleep)
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'tac-protocol', ts: Date.now() });
});
app.get('/api/ping', (req, res) => {
  res.status(200).json({ pong: true, ts: Date.now() });
});
app.get('/api/config-status', (req, res) => {
  const s = db.getSettings();
  res.json({
    bot_token: !!process.env.BOT_TOKEN,
    tonapi_key: !!process.env.TONAPI_KEY,
    ton_center_key: !!(process.env.TON_CENTER_API_KEY || process.env.TONCENTER_API_KEY),
    admin_ids_configured: !!(process.env.ADMIN_TELEGRAM_IDS || '').trim(),
    data_path: process.env.DATA_PATH || process.env.RENDER_DISK_PATH || '(default server folder — ephemeral on Render free)',
    treasury_configured: !!(s.treasury_address && String(s.treasury_address).trim()),
    verification_fee_ton: s.verification_fee_ton || 0.2,
    note: 'Missing keys do not invent payments. Verification uses public TonAPI and/or TON Center.'
  });
});
app.get('/api/debug/ref', (req, res) => {
  const code = parseReferralCode(req.query.code || req.query.startapp || req.query.ref);
  const referrer = code ? db.findByReferralCode(code) : null;
  res.json({
    parsed_code: code,
    found: !!referrer,
    referrer_id: referrer ? referrer.telegram_id : null,
    ...getBotInviteConfig(),
    tip: 'If Telegram says Username not found, bot_username is wrong. Set it in Admin → Settings or BOT_USERNAME env (no @).'
  });
});
app.head('/health', (req, res) => res.status(200).end());

// TON Connect manifest (absolute HTTPS URL required in production)
app.get('/tonconnect-manifest.json', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const base = process.env.APP_URL || `${proto}://${host}`;
  res.json({
    url: base,
    name: 'TAC PROTOCOL',
    iconUrl: `${base}/icon.svg`,
    termsOfUseUrl: `${base}/`,
    privacyPolicyUrl: `${base}/`
  });
});



function getLevel(balance, thresholds) {
  let level = 1;
  const t = thresholds || db.getSettings().level_thresholds;
  for (let i = 0; i < t.length; i++) {
    if (balance >= t[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 1000);
}

function getMiningPower(level, settings) {
  const s = settings || db.getSettings();
  return (s.mining_base_power || 0.05) + (level * (s.mining_level_multiplier || 0.04)) + (Math.pow(level, 1.15) * 0.008);
}


function getBotInviteConfig() {
  const s = db.getSettings();
  const bot = String(s.bot_username || process.env.BOT_USERNAME || '')
    .replace(/^@/, '')
    .trim();
  const path = String(s.mini_app_path || process.env.MINI_APP_PATH || '')
    .replace(/^\//, '')
    .trim();
  const appUrl = String(s.app_public_url || process.env.APP_URL || '')
    .replace(/\/$/, '')
    .trim();
  return { bot, path, appUrl };
}

function generateReferralCode() {
  return 'TAC' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/** Parse invite payload from Telegram start_param / startapp / ?ref= */
function parseReferralCode(startParam) {
  if (startParam == null || startParam === '') return null;
  let p = String(startParam).trim();
  try { p = decodeURIComponent(p); } catch (_) {}
  // Query-style: startapp=ref_XXX or ref=XXX
  if (p.includes('=')) {
    const parts = p.split(/[&?]/);
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (v && /^(startapp|start_param|ref|referral)$/i.test((k || '').trim())) {
        p = v.trim();
        break;
      }
    }
    if (p.includes('=')) p = p.split('=').pop();
  }
  p = p.replace(/^startapp[_-]?/i, '');
  if (/^ref[_-]/i.test(p)) p = p.replace(/^ref[_-]/i, '');
  p = p.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!p || p.length < 3) return null;
  return p;
}

function applyReferral(newUserId, startParam, settings) {
  const code = parseReferralCode(startParam);
  if (!code) {
    console.log('[ref] no code from', startParam);
    return null;
  }
  let referrer = db.findByReferralCode(code);
  // Fallback: payload is raw telegram id of referrer
  if (!referrer && /^\d{5,15}$/.test(code)) {
    referrer = db.getUser(code);
  }
  if (!referrer) {
    console.log('[ref] code not found:', code);
    return null;
  }
  if (String(referrer.telegram_id) === String(newUserId)) {
    console.log('[ref] self-referral blocked', newUserId);
    return null;
  }
  const isNew = db.addReferral(referrer.telegram_id, newUserId);
  if (!isNew) {
    console.log('[ref] already referred', newUserId);
    return String(referrer.telegram_id);
  }
  const refUser = db.getUser(referrer.telegram_id);
  if (refUser) {
    const bonus = settings.referral_bonus || 50;
    refUser.balance = (refUser.balance || 0) + bonus;
    refUser.squad_commission = (refUser.squad_commission || 0) + bonus;
    db.setUser(referrer.telegram_id, refUser);
  }
  console.log('[ref] linked', newUserId, '→', referrer.telegram_id, 'code', code);
  return String(referrer.telegram_id);
}


function authUser(req, res, next) {
  const telegramId = req.headers['x-telegram-id'] || (req.body && req.body.telegram_id) || req.query.telegram_id;
  if (!telegramId) return res.status(401).json({ ok: false, error: 'Unauthorized — reopen the Mini App from Telegram' });
  // If client sent signed initData, verify it matches the claimed telegram id
  const initData = req.headers['x-telegram-init-data'] || (req.body && req.body.initData);
  if (initData && process.env.BOT_TOKEN) {
    const v = validateTelegramWebAppData(initData);
    if (v.ok && v.user && v.user.id != null) {
      if (String(v.user.id) !== String(telegramId)) {
        return res.status(401).json({ ok: false, error: 'Telegram identity mismatch' });
      }
      req.telegramValidated = true;
    }
    // If validation fails we still allow header auth (compat) but log it
    else if (initData && !v.ok && v.reason === 'bad_hash') {
      console.warn('[auth] initData hash invalid for', telegramId);
    }
  }
  req.telegramId = String(telegramId);
  next();
}


/** Create a minimal user if missing (fixes User not found after disk reset / failed first login) */
function ensureUser(telegramId, extra = {}) {
  let user = db.getUser(telegramId);
  if (user) return user;
  const settings = db.getSettings();
  user = {
    telegram_id: String(telegramId),
    username: extra.username || null,
    first_name: extra.first_name || 'Miner',
    photo_url: extra.photo_url || null,
    balance: 10,
    unclaimed: 0,
    total_mined: 0,
    level: 1,
    mining_power: 0.1,
    last_claim: 0,
    last_mine_start: Date.now(),
    referral_code: generateReferralCode(),
    referred_by: null,
    wallet_address: null,
    wallet_verified: 0,
    status: 'active',
    created_at: Date.now(),
    checkin_streak: 0,
    last_checkin: 0,
    squad_commission: 0,
    channel1_ok: false,
    channel2_ok: false
  };
  // Optional invite on ensure
  if (extra.start_param || extra.ref) {
    const refBy = applyReferral(telegramId, extra.start_param || extra.ref, settings);
    if (refBy) user.referred_by = refBy;
  }
  db.setUser(telegramId, user);
  console.log('[user] auto-created', telegramId);
  return user;
}

function requireAdmin(req, res, next) {
  const telegramId = String(req.headers['x-telegram-id'] || req.body.telegram_id || req.query.telegram_id || '');
  if (!telegramId || !ADMIN_IDS.includes(telegramId)) {
    return res.status(403).json({ error: 'Admin access denied' });
  }
  req.telegramId = telegramId;
  req.isAdmin = true;
  next();
}

// ---------- Public / User APIs ----------

app.post('/api/user', (req, res) => {
  const { telegram_id, username, first_name, photo_url, start_param, ref, referral_code } = req.body;
  const invitePayload = start_param || ref || referral_code || null;
  console.log('[user] login', telegram_id, 'invite=', invitePayload);
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

  const settings = db.getSettings();
  let user = db.getUser(telegram_id);

  if (!user) {
    const referralCode = generateReferralCode();
    const referredBy = applyReferral(telegram_id, invitePayload, settings);

    user = {
      telegram_id: String(telegram_id),
      username: username || null,
      first_name: first_name || 'Miner',
      photo_url: photo_url || null,
      balance: 10,
      unclaimed: 0,
      total_mined: 0,
      level: 1,
      mining_power: 0.1,
      last_claim: 0,
      last_mine_start: Date.now(),
      referral_code: referralCode,
      referred_by: referredBy,
      wallet_address: null,
      wallet_verified: 0,
      status: 'active',
      created_at: Date.now(),
      checkin_streak: 0,
      last_checkin: 0,
      squad_commission: 0,
      channel1_ok: false,
      channel2_ok: false
    };
    db.setUser(telegram_id, user);
  } else {
    user.username = username || user.username;
    user.first_name = first_name || user.first_name;
    user.photo_url = photo_url || user.photo_url;
    // Late attribution: only if never referred before
    if (!user.referred_by && invitePayload) {
      const referredBy = applyReferral(telegram_id, invitePayload, settings);
      if (referredBy) {
        user.referred_by = referredBy;
        db.setUser(telegram_id, user);
      }
    } else {
      db.setUser(telegram_id, user);
    }
  }

  if (user.status === 'banned') {
    return res.status(403).json({ error: 'Account suspended' });
  }

  const totalHold = user.balance;
  user.level = getLevel(totalHold, settings.level_thresholds);
  user.mining_power = getMiningPower(user.level, settings);
  db.setUser(telegram_id, user);

  const now = Date.now();
  const elapsedHours = Math.min((now - (user.last_mine_start || now)) / 3600000, 24);
  const pending = user.mining_power * elapsedHours;

  const isAdmin = ADMIN_IDS.includes(String(telegram_id));

  res.json({
    ...user,
    pending_reward: Math.max(0, pending),
    next_level_need: (settings.level_thresholds[user.level] || totalHold + 100) - totalHold,
    level_progress: Math.min(1, (totalHold - (settings.level_thresholds[user.level - 1] || 0)) /
      ((settings.level_thresholds[user.level] || totalHold + 1) - (settings.level_thresholds[user.level - 1] || 0))),
    is_admin: isAdmin,
    channel1_ok: !!user.channel1_ok,
    channel2_ok: !!user.channel2_ok,
    completed_task_ids: db.getCompletedTaskIds(telegram_id),
    settings_public: {
      min_withdrawal: settings.min_withdrawal,
      withdrawal_fee: settings.withdrawal_fee,
      wallet_verification_enabled: settings.wallet_verification_enabled,
      verification_fee_ton: settings.verification_fee_ton || 0.2,
      treasury_address: settings.treasury_address || '',
      channel_1_link: settings.channel_1_link,
      channel_2_link: settings.channel_2_link,
      youtube_link: settings.youtube_link,
      checkin_rewards: settings.checkin_rewards,
      honor_system_youtube: !!settings.honor_system_youtube,
      announcement: settings.announcement || '',
      bot_username: getBotInviteConfig().bot,
      mini_app_path: getBotInviteConfig().path,
      app_public_url: getBotInviteConfig().appUrl,
      tasks: (settings.tasks || []).filter(t => t.enabled !== false)
    }
  });
});

app.post('/api/claim', authUser, (req, res) => {
  const user = ensureUser(req.telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status === 'banned') return res.status(403).json({ error: 'Account suspended' });

  const settings = db.getSettings();
  const now = Date.now();
  const elapsedHours = Math.min((now - (user.last_mine_start || now)) / 3600000, 24);
  const reward = Math.floor(user.mining_power * elapsedHours * 10000) / 10000;

  if (reward < 0.0001) return res.status(400).json({ error: 'Nothing to claim yet' });
  if (now - (user.last_claim || 0) < 10000) return res.status(429).json({ error: 'Please wait before claiming again' });

  user.balance += reward;
  user.total_mined += reward;
  user.last_claim = now;
  user.last_mine_start = now;
  user.unclaimed = 0;
  db.setUser(req.telegramId, user);
  db.addClaim(req.telegramId, reward);

  if (user.referred_by) {
    const pct = (settings.referral_commission_pct || 10) / 100;
    const commission = reward * pct;
    const ref = db.getUser(user.referred_by);
    if (ref) {
      ref.balance += commission;
      ref.squad_commission = (ref.squad_commission || 0) + commission;
      db.setUser(user.referred_by, ref);
    }
  }

  res.json({ success: true, claimed: reward, balance: user.balance, total_mined: user.total_mined });
});

app.post('/api/checkin', authUser, (req, res) => {
  const user = ensureUser(req.telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status === 'banned') return res.status(403).json({ error: 'Account suspended' });

  const settings = db.getSettings();
  const now = Date.now();
  const oneDay = 86400000;
  if (now - (user.last_checkin || 0) < oneDay - 3600000) {
    return res.status(400).json({ error: 'Already checked in today' });
  }

  let streak = user.checkin_streak || 0;
  if (now - (user.last_checkin || 0) > oneDay * 1.5) streak = 0;
  streak = Math.min(streak + 1, 7);
  const rewards = settings.checkin_rewards || [5, 6, 7, 8, 9, 10, 15];
  const reward = rewards[streak - 1] || 5;

  user.balance += reward;
  user.checkin_streak = streak;
  user.last_checkin = now;
  db.setUser(req.telegramId, user);

  res.json({ success: true, reward, streak, day: streak });
});

async function checkTelegramMembership(chatId, userId) {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    return { ok: false, error: 'BOT_TOKEN not configured on server. Channel membership cannot be verified.' };
  }
  if (!chatId) {
    return { ok: false, error: 'Channel chat_id not configured. Set it in Admin settings.' };
  }
  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) {
      return {
        ok: false,
        error: data.description || 'Telegram API error. Ensure the bot is an admin of the channel.'
      };
    }
    const status = data.result && data.result.status;
    const member = ['creator', 'administrator', 'member', 'restricted'].includes(status);
    if (!member) {
      return { ok: false, error: 'You are not a member of this channel yet. Join first, then Verify.' };
    }
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: 'Failed to reach Telegram API: ' + (e.message || 'network error') };
  }
}

app.post('/api/task', authUser, async (req, res) => {
  const { task_id, action } = req.body;
  const settings = db.getSettings();
  const task = (settings.tasks || []).find(t => t.id === task_id && t.enabled !== false);
  if (!task) return res.status(400).json({ error: 'Invalid or disabled task' });

  if (action === 'open') {
    return res.json({ success: true, opened: true });
  }

  const user = db.getUser(req.telegramId);
  if (!user || user.status === 'banned') return res.status(403).json({ error: 'Account suspended' });

  if (db.hasCompletedTask(req.telegramId, task_id)) {
    return res.json({
      success: true,
      already: true,
      reward: 0,
      verified: true,
      message: 'Task already completed',
      completed_task_ids: db.getCompletedTaskIds(req.telegramId)
    });
  }

  if (task.type === 'telegram_channel') {
    const chatId = task.chat_id || settings.channel_1_chat_id || settings.channel_2_chat_id;
    if (!process.env.BOT_TOKEN) {
      return res.status(400).json({
        error: 'BOT_TOKEN not configured. Telegram membership cannot be verified.',
        verified: false
      });
    }
    const check = await checkTelegramMembership(task.chat_id || chatId, req.telegramId);
    if (!check.ok) {
      console.log('[task] membership fail', task_id, req.telegramId, check.error);
      return res.status(400).json({ error: check.error, verified: false });
    }
  } else if (task.type === 'youtube') {
    // No Google OAuth — self-reported only when admin enables honor system
    if (!settings.honor_system_youtube) {
      return res.status(400).json({
        error: 'YouTube cannot be verified without Google OAuth. Admin can enable honor-system YouTube rewards.',
        verified: false
      });
    }
  } else {
    return res.status(400).json({ error: 'Unsupported task type' });
  }

  const reward = Number(task.reward) || 5;
  db.addTaskCompletion(req.telegramId, task_id, reward);
  user.balance = (user.balance || 0) + reward;
  // Channel tasks unlock flags for invite list status
  if (task.id === 'join_channel_1') { user.channel1_ok = true; user.channel1_ok_at = Date.now(); }
  if (task.id === 'join_channel_2') { user.channel2_ok = true; user.channel2_ok_at = Date.now(); }
  db.setUser(req.telegramId, user);
  console.log('[task] completed', task_id, req.telegramId, '+', reward);

  res.json({
    success: true,
    reward,
    verified: true,
    message: 'Task completed successfully!',
    completed_task_ids: db.getCompletedTaskIds(req.telegramId),
    channel1_ok: !!user.channel1_ok,
    channel2_ok: !!user.channel2_ok
  });
});


// ---------- Channel membership gates ----------
app.get('/api/membership', authUser, async (req, res) => {
  const settings = db.getSettings();
  const user = db.getUser(req.telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Return cached flags + links; live re-check is POST /api/membership/verify
  res.json({
    channel_1: {
      ok: !!user.channel1_ok,
      link: settings.channel_1_link || '',
      chat_id: settings.channel_1_chat_id || '',
      verified_at: user.channel1_ok_at || null
    },
    channel_2: {
      ok: !!user.channel2_ok,
      link: settings.channel_2_link || '',
      chat_id: settings.channel_2_chat_id || '',
      verified_at: user.channel2_ok_at || null
    },
    bot_token_configured: !!process.env.BOT_TOKEN
  });
});

app.post('/api/membership/verify', authUser, async (req, res) => {
  try {
    const channel = Number((req.body && req.body.channel) || 0);
    if (channel !== 1 && channel !== 2) {
      return res.status(400).json({ ok: false, error: 'channel must be 1 or 2' });
    }
    const settings = db.getSettings();
    const chatId = channel === 1 ? settings.channel_1_chat_id : settings.channel_2_chat_id;
    const link = channel === 1 ? settings.channel_1_link : settings.channel_2_link;

    if (!process.env.BOT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'BOT_TOKEN is not set on the server. Add it in Render Environment, then redeploy.'
      });
    }
    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'Channel ' + channel + ' chat_id not set. Admin → Settings → set chat ID (e.g. @yourchannel).'
      });
    }

    const check = await checkTelegramMembership(chatId, req.telegramId);
    console.log('[membership] ch' + channel, req.telegramId, check);

    const user = db.getUser(req.telegramId);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found. Reopen the Mini App.' });

    if (!check.ok) {
      if (channel === 1) { user.channel1_ok = false; user.channel1_ok_at = null; }
      else { user.channel2_ok = false; user.channel2_ok_at = null; }
      db.setUser(req.telegramId, user);
      return res.status(200).json({
        ok: false,
        channel,
        error: check.error || 'Not a member yet. Join the channel, then tap Verify again.',
        link
      });
    }

    if (channel === 1) {
      user.channel1_ok = true;
      user.channel1_ok_at = Date.now();
    } else {
      user.channel2_ok = true;
      user.channel2_ok_at = Date.now();
    }
    db.setUser(req.telegramId, user);

    return res.json({
      ok: true,
      channel,
      status: check.status,
      channel1_ok: !!user.channel1_ok,
      channel2_ok: !!user.channel2_ok
    });
  } catch (e) {
    console.error('[membership] error', e);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + (e.message || 'unknown')
    });
  }
});

// Quick probe so frontend can detect if route exists
app.get('/api/membership/ping', (req, res) => {
  res.json({ ok: true, bot: !!process.env.BOT_TOKEN });
});

function isValidTonAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  if (addr.includes('...')) return false;
  // Bounceable/non-bounceable user-friendly
  if (/^(UQ|EQ)[A-Za-z0-9_-]{46,48}$/.test(addr)) return true;
  // Raw workchain:hex
  if (/^-?[0-9]:[a-fA-F0-9]{64}$/.test(addr)) return true;
  return false;
}


/** Normalize TON address forms for comparison (strip 0: prefix variation loosely) */
function addrKey(a) {
  if (!a) return '';
  return String(a).trim().toLowerCase();
}

/**
 * Look up a verification payment on-chain via TonAPI (public) or TONAPI_KEY.
 * Requires incoming transfer >= minNano from user's wallet to treasury.
 */
function addressesMatch(a, b) {
  const ka = addrKey(a);
  const kb = addrKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ha = ka.includes(':') ? ka.split(':')[1] : ka.replace(/^(uq|eq)/i, '');
  const hb = kb.includes(':') ? kb.split(':')[1] : kb.replace(/^(uq|eq)/i, '');
  if (!ha || !hb) return false;
  return ha === hb || ha.startsWith(hb.slice(0, 40)) || hb.startsWith(ha.slice(0, 40));
}

/** TonAPI primary lookup */
async function findPaymentViaTonApi({ treasury, fromAddress, minNano, telegramId }) {
  const headers = { Accept: 'application/json' };
  if (process.env.TONAPI_KEY) headers.Authorization = 'Bearer ' + process.env.TONAPI_KEY;
  const url = `https://tonapi.io/v2/accounts/${encodeURIComponent(treasury)}/events?limit=50`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error('TonAPI HTTP ' + resp.status);
  const events = await resp.json();
  for (const ev of (events.events || [])) {
    for (const action of (ev.actions || [])) {
      const tonTransfer = action.TonTransfer || action.ton_transfer;
      if (!tonTransfer) continue;
      const senderObj = tonTransfer.sender;
      const sender = typeof senderObj === 'string' ? senderObj : (senderObj && senderObj.address);
      if (!sender) continue;
      const amount = BigInt(tonTransfer.amount || 0);
      if (amount < minNano) continue;
      if (!addressesMatch(sender, fromAddress)) continue;
      const txHash = String(ev.event_id || ev.lt || ev.tx_hash || '');
      if (!txHash) continue;
      const used = db.findPaymentByTx(txHash);
      if (used && used.telegram_id !== String(telegramId)) continue;
      return { ok: true, tx_hash: txHash, amount_ton: Number(amount) / 1e9, source: 'tonapi' };
    }
  }
  return null;
}

/**
 * TON Center API fallback (https://toncenter.com)
 * Set TON_CENTER_API_KEY in env for higher limits.
 */
async function findPaymentViaTonCenter({ treasury, fromAddress, minNano, telegramId }) {
  const key = process.env.TON_CENTER_API_KEY || process.env.TONCENTER_API_KEY || '';
  const base = process.env.TON_CENTER_URL || 'https://toncenter.com/api/v2';
  const qs = new URLSearchParams({
    address: treasury,
    limit: '30'
  });
  if (key) qs.set('api_key', key);
  const url = base.replace(/\/$/, '') + '/getTransactions?' + qs.toString();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('TON Center HTTP ' + resp.status);
  const data = await resp.json();
  if (!data.ok || !Array.isArray(data.result)) throw new Error('TON Center invalid response');

  for (const tx of data.result) {
    const inMsg = tx.in_msg || {};
    // Incoming message value to treasury
    const value = BigInt(inMsg.value || 0);
    if (value < minNano) continue;
    const source = inMsg.source || '';
    if (!source || !addressesMatch(source, fromAddress)) continue;
    const txHash = String(tx.transaction_id?.hash || tx.transaction_id?.lt || tx.in_msg?.hash || '');
    if (!txHash) continue;
    const used = db.findPaymentByTx(txHash);
    if (used && used.telegram_id !== String(telegramId)) continue;
    return { ok: true, tx_hash: txHash, amount_ton: Number(value) / 1e9, source: 'toncenter' };
  }
  return null;
}

/**
 * Look up verification payment on-chain: TonAPI first, then TON Center.
 * Requires inbound transfer >= minNano from connected wallet to treasury.
 */
async function findVerificationPayment({ treasury, fromAddress, minNano, telegramId }) {
  const errors = [];
  try {
    const hit = await findPaymentViaTonApi({ treasury, fromAddress, minNano, telegramId });
    if (hit) return hit;
  } catch (e) {
    errors.push('TonAPI: ' + (e.message || e));
    console.warn('[pay] TonAPI failed', e.message || e);
  }
  try {
    const hit = await findPaymentViaTonCenter({ treasury, fromAddress, minNano, telegramId });
    if (hit) return hit;
  } catch (e) {
    errors.push('TON Center: ' + (e.message || e));
    console.warn('[pay] TON Center failed', e.message || e);
  }
  const detail = errors.length ? ' (' + errors.join('; ') + ')' : '';
  return {
    ok: false,
    error: `No incoming ≥ ${Number(minNano) / 1e9} TON from your wallet to the treasury was found yet. Wait ~30s after paying, then Refresh Status.` + detail
  };
}

/** Optional Telegram WebApp initData HMAC validation (when BOT_TOKEN is set) */
function validateTelegramWebAppData(initData) {
  if (!initData || !process.env.BOT_TOKEN) return { ok: false, reason: 'missing' };
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { ok: false, reason: 'no_hash' };
    params.delete('hash');
    const entries = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => k + '=' + v).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calc !== hash) return { ok: false, reason: 'bad_hash' };
    const userRaw = params.get('user');
    let user = null;
    if (userRaw) {
      try { user = JSON.parse(userRaw); } catch (_) {}
    }
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}



app.post('/api/wallet', authUser, (req, res) => {
  const { address, action } = req.body;
  const user = ensureUser(req.telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (action === 'disconnect') {
    user.wallet_address = null;
    // Keep verification status tied to previous address; clear on disconnect for safety
    user.wallet_verified = 0;
    user.wallet_verified_at = null;
    db.setUser(req.telegramId, user);
    return res.json({ success: true, address: null, disconnected: true });
  }

  if (!isValidTonAddress(address)) {
    return res.status(400).json({ error: 'Invalid TON address. Connect via TON Connect only.' });
  }

  // New address requires re-verification
  if (user.wallet_address && user.wallet_address !== address) {
    user.wallet_verified = 0;
    user.wallet_verified_at = null;
  }
  user.wallet_address = address;
  db.setUser(req.telegramId, user);
  res.json({ success: true, address });
});

app.post('/api/verify-wallet', authUser, async (req, res) => {
  const settings = db.getSettings();
  if (!settings.wallet_verification_enabled) {
    return res.status(400).json({ error: 'Wallet verification is currently disabled' });
  }
  const user = ensureUser(req.telegramId);
  if (!user || !user.wallet_address) {
    return res.status(400).json({ error: 'Connect wallet first via TON Connect' });
  }
  if (user.wallet_verified) {
    return res.json({ success: true, verified: true, already: true, tx_hash: user.payment_tx_hash || null });
  }

  const feeTon = Number(settings.verification_fee_ton || 0.2);
  const feeNano = BigInt(Math.round(feeTon * 1e9));
  const treasury = (settings.treasury_address || '').trim();
  if (!treasury) {
    return res.status(400).json({
      error: 'Treasury address not configured. Admin must set it before verification.',
      fee_ton: feeTon,
      verified: false
    });
  }

  try {
    const match = await findVerificationPayment({
      treasury,
      fromAddress: user.wallet_address,
      minNano: feeNano,
      telegramId: req.telegramId
    });

    if (!match.ok) {
      return res.status(400).json({
        error: match.error,
        fee_ton: feeTon,
        treasury,
        verified: false
      });
    }

    // Duplicate protection
    const existing = db.findPaymentByTx(match.tx_hash);
    if (existing && existing.telegram_id !== String(req.telegramId)) {
      return res.status(400).json({
        error: 'This payment transaction was already used by another account.',
        verified: false
      });
    }
    if (existing && existing.telegram_id === String(req.telegramId) && user.wallet_verified) {
      return res.json({ success: true, verified: true, already: true, tx_hash: match.tx_hash });
    }

    user.wallet_verified = 1;
    user.wallet_verified_at = Date.now();
    user.payment_tx_hash = match.tx_hash;
    user.payment_amount_ton = match.amount_ton;
    db.setUser(req.telegramId, user);
    if (!existing) {
      db.addPayment({
        tx_hash: match.tx_hash,
        telegram_id: String(req.telegramId),
        amount_ton: match.amount_ton,
        from: user.wallet_address,
        to: treasury
      });
    }

    res.json({
      success: true,
      verified: true,
      tx_hash: match.tx_hash,
      amount_ton: match.amount_ton
    });
  } catch (e) {
    console.error('verify-wallet error', e);
    res.status(500).json({
      error: 'Blockchain lookup failed. Try again later.',
      verified: false
    });
  }
});


app.post('/api/withdraw', authUser, (req, res) => {
  const { amount } = req.body;
  const user = ensureUser(req.telegramId);
  const settings = db.getSettings();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status === 'banned') return res.status(403).json({ error: 'Account suspended' });
  if (settings.wallet_verification_enabled && !user.wallet_verified) {
    return res.status(403).json({ error: 'Wallet not verified' });
  }
  if (!user.wallet_address) return res.status(400).json({ error: 'No wallet connected' });

  const amt = parseFloat(amount);
  const minW = settings.min_withdrawal || 10;
  if (isNaN(amt) || amt < minW) return res.status(400).json({ error: `Minimum withdrawal ${minW} TAC` });
  if (amt > user.balance) return res.status(400).json({ error: 'Insufficient balance' });

  const fee = settings.withdrawal_fee || 2;
  user.balance -= amt;
  db.setUser(req.telegramId, user);
  const entry = db.addWithdrawal({
    telegram_id: req.telegramId,
    amount: amt,
    fee,
    status: 'pending',
    wallet_address: user.wallet_address
  });

  res.json({
    success: true,
    status: 'processing',
    amount: amt,
    fee,
    net: amt - fee,
    id: entry.id,
    message: 'Withdrawal processing'
  });
});

app.get('/api/withdrawals', authUser, (req, res) => {
  res.json(db.getWithdrawals(req.telegramId));
});

app.get('/api/payments/me', authUser, (req, res) => {
  const all = db.getPayments(500);
  const mine = all.filter(p => String(p.telegram_id) === String(req.telegramId));
  const user = db.getUser(req.telegramId);
  res.json({
    payments: mine,
    wallet_verified: !!(user && user.wallet_verified),
    payment_tx_hash: user ? (user.payment_tx_hash || null) : null,
    wallet_verified_at: user ? (user.wallet_verified_at || null) : null
  });
});

app.get('/api/referrals', authUser, (req, res) => {
  res.json(db.getReferralDetails(req.telegramId));
});

app.get('/api/levels', (req, res) => {
  res.json({ thresholds: db.getSettings().level_thresholds });
});

app.get('/api/public-settings', (req, res) => {
  const s = db.getSettings();
  res.json({
    min_withdrawal: s.min_withdrawal,
    withdrawal_fee: s.withdrawal_fee,
    wallet_verification_enabled: s.wallet_verification_enabled,
    verification_fee_ton: s.verification_fee_ton || 0.2,
    treasury_address: s.treasury_address || '',
    channel_1_link: s.channel_1_link,
    channel_2_link: s.channel_2_link,
    youtube_link: s.youtube_link,
    checkin_rewards: s.checkin_rewards,
    honor_system_youtube: !!s.honor_system_youtube,
    bot_username: getBotInviteConfig().bot,
    mini_app_path: getBotInviteConfig().path,
    app_public_url: getBotInviteConfig().appUrl,
    tasks: (s.tasks || []).filter(t => t.enabled !== false)
  });
});

// Check if current user is admin (used by frontend to show Admin button)
app.get('/api/me/admin', authUser, (req, res) => {
  ensureUser(req.telegramId);
  const isAdmin = ADMIN_IDS.includes(String(req.telegramId));
  res.json({ is_admin: isAdmin, telegram_id: String(req.telegramId) });
});

// ---------- ADMIN APIs (requireAdmin) ----------

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json(db.getStats());
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.getAllUsers().map(u => {
    const tasks = db.getTaskCompletionsForUser(u.telegram_id);
    const taskIds = [...new Set(tasks.map(x => x.task_id))];
    return {
      telegram_id: u.telegram_id,
      username: u.username,
      first_name: u.first_name,
      balance: u.balance,
      total_mined: u.total_mined,
      level: u.level,
      status: u.status || 'active',
      wallet_address: u.wallet_address,
      wallet_verified: !!u.wallet_verified,
      payment_tx_hash: u.payment_tx_hash || null,
      referred_by: u.referred_by || null,
      referral_code: u.referral_code || null,
      tasks_completed: taskIds,
      task_count: taskIds.length,
      created_at: u.created_at,
      last_claim: u.last_claim
    };
  });
  res.json(users);
});

app.post('/api/admin/users/:id/status', requireAdmin, (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { status } = req.body;
  if (!['active', 'banned', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  user.status = status;
  db.setUser(req.params.id, user);
  res.json({ success: true, status });
});

app.post('/api/admin/users/:id/balance', requireAdmin, (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { balance, reason } = req.body;
  if (typeof balance !== 'number' || balance < 0) return res.status(400).json({ error: 'Invalid balance' });
  user.balance = balance;
  db.setUser(req.params.id, user);
  res.json({ success: true, balance, reason: reason || null });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    const allowed = [
      'min_withdrawal', 'withdrawal_fee', 'referral_bonus', 'referral_commission_pct',
      'wallet_verification_enabled', 'verification_fee_ton', 'treasury_address',
      'require_onchain_verify', 'honor_system_youtube',
      'channel_1_link', 'channel_1_chat_id', 'channel_2_link', 'channel_2_chat_id',
      'youtube_link', 'announcement', 'bot_username', 'mini_app_path', 'app_public_url',
      'mining_base_power', 'mining_level_multiplier',
      'level_thresholds', 'checkin_rewards', 'tasks'
    ];
    const partial = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) partial[key] = req.body[key];
    }
    if (typeof partial.treasury_address === 'string') {
      partial.treasury_address = partial.treasury_address.trim();
      if (partial.treasury_address && !isValidTonAddress(partial.treasury_address)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid TON treasury address. Use a wallet address starting with UQ or EQ.'
        });
      }
    }
    if (partial.verification_fee_ton != null) {
      const fee = Number(partial.verification_fee_ton);
      if (!(fee > 0 && fee < 100)) {
        return res.status(400).json({ success: false, error: 'verification_fee_ton must be between 0 and 100' });
      }
      partial.verification_fee_ton = fee;
    }
    // Sync task chat/links from channel settings when provided
    const updated = db.setSettings(partial);
    const tasks = (updated.tasks || []).map(t => {
      if (t.id === 'join_channel_1') {
        return {
          ...t,
          link: updated.channel_1_link || t.link,
          chat_id: updated.channel_1_chat_id || t.chat_id
        };
      }
      if (t.id === 'join_channel_2') {
        return {
          ...t,
          link: updated.channel_2_link || t.link,
          chat_id: updated.channel_2_chat_id || t.chat_id
        };
      }
      if (t.id === 'youtube_subscribe') {
        return { ...t, link: updated.youtube_link || t.link };
      }
      return t;
    });
    const final = db.setSettings({ tasks });
    console.log('[admin] settings saved treasury=', final.treasury_address ? final.treasury_address.slice(0, 12) + '…' : '(empty)');
    res.json({
      success: true,
      settings: final,
      treasury_address: final.treasury_address || ''
    });
  } catch (e) {
    console.error('[admin] settings error', e);
    res.status(500).json({ success: false, error: e.message || 'Save failed' });
  }
});

app.get('/api/admin/withdrawals', requireAdmin, (req, res) => {
  res.json(db.getAllWithdrawals());
});

app.post('/api/admin/withdrawals/:id', requireAdmin, (req, res) => {
  const { status, tx_hash, note } = req.body;
  if (!['pending', 'approved', 'rejected', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  // paid = admin confirmed they sent the jetton on-chain. We never auto-send.
  const updates = { status, processed_at: Date.now() };
  if (tx_hash) updates.tx_hash = tx_hash;
  if (note) updates.note = note;

  if (status === 'rejected') {
    const w = db.getAllWithdrawals().find(x => x.id === Number(req.params.id));
    if (w && w.status === 'pending') {
      const user = db.getUser(w.telegram_id);
      if (user) {
        user.balance += w.amount;
        db.setUser(w.telegram_id, user);
      }
    }
  }

  const updated = db.updateWithdrawal(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Withdrawal not found' });
  res.json({ success: true, status: 'processing', message: 'Withdrawal processing', withdrawal: updated });
});

app.get('/api/admin/claims', requireAdmin, (req, res) => {
  res.json(db.getClaims(200));
});

app.get('/api/admin/payments', requireAdmin, (req, res) => {
  res.json(db.getPayments(200));
});

app.get('/api/admin/referrals', requireAdmin, (req, res) => {
  const users = db.getAllUsers();
  const all = [];
  for (const u of users) {
    const details = db.getReferralDetails(u.telegram_id);
    if (details.length) {
      all.push({
        referrer_id: u.telegram_id,
        referrer_name: u.first_name,
        count: details.length,
        referrals: details
      });
    }
  }
  res.json(all);
});

// Admin confirms on-chain 0.2 TON verification (never auto-confirmed by client)
app.post('/api/admin/users/:id/verify-wallet', requireAdmin, (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.wallet_verified = 1;
  user.wallet_verified_at = Date.now();
  db.setUser(req.params.id, user);
  res.json({ success: true, telegram_id: user.telegram_id, wallet_verified: true });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

console.log('[boot] ADMIN_IDS count=', ADMIN_IDS.length, 'ids=', ADMIN_IDS.map(id => id.slice(0,4)+'…').join(','));
app.listen(PORT, () => {
  console.log(`TAC PROTOCOL server on http://localhost:${PORT}`);
  console.log(`Admin IDs configured: ${ADMIN_IDS.length ? ADMIN_IDS.join(', ') : '(none — set ADMIN_TELEGRAM_IDS)'}`);
});
