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
app.get('/api/debug/ref', (req, res) => {
  const code = parseReferralCode(req.query.code || req.query.startapp || req.query.ref);
  const referrer = code ? db.findByReferralCode(code) : null;
  res.json({
    parsed_code: code,
    found: !!referrer,
    referrer_id: referrer ? referrer.telegram_id : null,
    bot_username: process.env.BOT_USERNAME || null,
    mini_app_path: process.env.MINI_APP_PATH || '',
    tip: 'Invite links must use your real BOT_USERNAME. startapp payload example: ref_TACXXXX'
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
  const referrer = db.findByReferralCode(code);
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
  const telegramId = req.headers['x-telegram-id'] || req.body.telegram_id;
  if (!telegramId) return res.status(401).json({ error: 'Unauthorized' });
  req.telegramId = String(telegramId);
  next();
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
      squad_commission: 0
    };
    db.setUser(telegram_id, user);
  } else {
    user.username = username || user.username;
    user.first_name = first_name || user.first_name;
    user.photo_url = photo_url || user.photo_url;
    // Late attribution: only if never referred before
    if (!user.referred_by && start_param) {
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
      bot_username: process.env.BOT_USERNAME || 'tacprotocolbot',
      mini_app_path: process.env.MINI_APP_PATH || '',
      tasks: (settings.tasks || []).filter(t => t.enabled !== false)
    }
  });
});

app.post('/api/claim', authUser, (req, res) => {
  const user = db.getUser(req.telegramId);
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
  const user = db.getUser(req.telegramId);
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

  // Opening a link does not award rewards
  if (action === 'open') {
    return res.json({ success: true, opened: true });
  }

  const user = db.getUser(req.telegramId);
  if (!user || user.status === 'banned') return res.status(403).json({ error: 'Account suspended' });

  // One-time only — never pay the same task twice
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

  // Honor-system verification for Telegram channels + YouTube.
  // No Google OAuth. No paid APIs. Self-reported after user opened the link.
  const allowed = ['telegram_channel', 'youtube'];
  if (!allowed.includes(task.type)) {
    return res.status(400).json({ error: 'Unsupported task type' });
  }

  const reward = Number(task.reward) || 5;
  db.addTaskCompletion(req.telegramId, task_id, reward);
  user.balance = (user.balance || 0) + reward;
  db.setUser(req.telegramId, user);

  res.json({
    success: true,
    reward,
    verified: true,
    honor_system: true,
    message: 'Task completed successfully!',
    completed_task_ids: db.getCompletedTaskIds(req.telegramId)
  });
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
async function findVerificationPayment({ treasury, fromAddress, minNano, telegramId }) {
  const headers = { Accept: 'application/json' };
  if (process.env.TONAPI_KEY) {
    headers.Authorization = 'Bearer ' + process.env.TONAPI_KEY;
  }

  // Prefer events API for incoming TON
  const account = encodeURIComponent(treasury);
  const url = `https://tonapi.io/v2/accounts/${account}/events?limit=50`;
  let events;
  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      return { ok: false, error: `TonAPI error ${resp.status}. Check treasury address or set TONAPI_KEY.` };
    }
    events = await resp.json();
  } catch (e) {
    return { ok: false, error: 'Could not reach TonAPI: ' + (e.message || 'network') };
  }

  const list = events.events || events || [];
  const fromKey = addrKey(fromAddress);

  // Events are for the treasury account — any matching inbound TON from the user wallet counts
  for (const ev of list) {
    const actions = ev.actions || [];
    for (const action of actions) {
      const tonTransfer = action.TonTransfer || action.ton_transfer;
      if (!tonTransfer) continue;
      const senderObj = tonTransfer.sender;
      const sender = typeof senderObj === 'string' ? senderObj : (senderObj && senderObj.address);
      if (!sender) continue;
      const amount = BigInt(tonTransfer.amount || 0);
      if (amount < minNano) continue;

      const senderStr = addrKey(sender);
      const fromHex = fromKey.includes(':') ? fromKey.split(':')[1] : fromKey.replace(/^(uq|eq)/i, '');
      const senderHex = senderStr.includes(':') ? senderStr.split(':')[1] : senderStr;

      // Require sender == connected wallet (raw 0:hex from TON Connect matches TonAPI)
      const senderOk =
        senderStr === fromKey ||
        (fromHex && senderHex && (senderHex === fromHex || senderHex.startsWith(fromHex.slice(0, 40)) || fromHex.startsWith(senderHex.slice(0, 40))));

      if (!senderOk) continue;

      const txHash = ev.event_id || ev.lt || ev.tx_hash || `${ev.timestamp}-${amount.toString()}`;
      if (!txHash) continue;

      const used = db.findPaymentByTx(String(txHash));
      if (used && used.telegram_id !== String(telegramId)) continue;

      return {
        ok: true,
        tx_hash: String(txHash),
        amount_ton: Number(amount) / 1e9
      };
    }
  }

  return {
    ok: false,
    error: `No incoming ≥ ${Number(minNano) / 1e9} TON payment from your connected wallet to the treasury was found yet. Send the exact amount, wait ~30s, then try again.`
  };
}


app.post('/api/wallet', authUser, (req, res) => {
  const { address, action } = req.body;
  const user = db.getUser(req.telegramId);
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
  const user = db.getUser(req.telegramId);
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
  const user = db.getUser(req.telegramId);
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
    amount: amt,
    fee,
    net: amt - fee,
    id: entry.id,
    message: 'Withdrawal queued. Admin will process and send on-chain. No automatic transfer is performed by this server.'
  });
});

app.get('/api/withdrawals', authUser, (req, res) => {
  res.json(db.getWithdrawals(req.telegramId));
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
    bot_username: process.env.BOT_USERNAME || 'tacprotocolbot',
    mini_app_path: process.env.MINI_APP_PATH || '',
    tasks: (s.tasks || []).filter(t => t.enabled !== false)
  });
});

// Check if current user is admin (used by frontend to show Admin button)
app.get('/api/me/admin', authUser, (req, res) => {
  res.json({ is_admin: ADMIN_IDS.includes(req.telegramId) });
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
  const allowed = [
    'min_withdrawal', 'withdrawal_fee', 'referral_bonus', 'referral_commission_pct',
    'wallet_verification_enabled', 'verification_fee_ton', 'treasury_address',
    'require_onchain_verify', 'honor_system_youtube',
    'channel_1_link', 'channel_1_chat_id', 'channel_2_link', 'channel_2_chat_id',
    'youtube_link', 'announcement',
    'mining_base_power', 'mining_level_multiplier',
    'level_thresholds', 'checkin_rewards', 'tasks'
  ];
  const partial = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) partial[key] = req.body[key];
  }
  const updated = db.setSettings(partial);
  res.json({ success: true, settings: updated });
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
  res.json({ success: true, withdrawal: updated });
});

app.get('/api/admin/claims', requireAdmin, (req, res) => {
  res.json(db.getClaims(200));
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

app.listen(PORT, () => {
  console.log(`TAC PROTOCOL server on http://localhost:${PORT}`);
  console.log(`Admin IDs configured: ${ADMIN_IDS.length ? ADMIN_IDS.join(', ') : '(none — set ADMIN_TELEGRAM_IDS)'}`);
});
