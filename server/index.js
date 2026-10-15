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
  const { telegram_id, username, first_name, photo_url, start_param } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

  const settings = db.getSettings();
  let user = db.getUser(telegram_id);

  if (!user) {
    const referralCode = generateReferralCode();
    let referredBy = null;
    if (start_param && start_param.startsWith('ref_')) {
      const refCode = start_param.replace('ref_', '');
      const referrer = db.findByReferralCode(refCode);
      if (referrer) referredBy = referrer.telegram_id;
    }

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

    if (referredBy) {
      db.addReferral(referredBy, telegram_id);
      const refUser = db.getUser(referredBy);
      if (refUser) {
        refUser.balance += (settings.referral_bonus || 50);
        db.setUser(referredBy, refUser);
      }
    }
  } else {
    user.username = username || user.username;
    user.first_name = first_name || user.first_name;
    user.photo_url = photo_url || user.photo_url;
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
      verification_fee_ton: settings.verification_fee_ton,
      channel_link: settings.channel_link,
      youtube_link: settings.youtube_link,
      x_link: settings.x_link,
      checkin_rewards: settings.checkin_rewards,
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

app.post('/api/task', authUser, (req, res) => {
  const { task_id } = req.body;
  const settings = db.getSettings();
  const task = (settings.tasks || []).find(t => t.id === task_id && t.enabled !== false);
  if (!task) return res.status(400).json({ error: 'Invalid or disabled task' });

  const recent = db.getRecentTask(req.telegramId, task_id);
  if (recent && (Date.now() - recent.completed_at) / 1000 < (task.cooldown || 0)) {
    return res.status(429).json({ error: 'Task on cooldown' });
  }

  db.addTaskCompletion(req.telegramId, task_id, task.reward);
  const user = db.getUser(req.telegramId);
  if (!user || user.status === 'banned') return res.status(403).json({ error: 'Account suspended' });
  user.balance += task.reward;
  db.setUser(req.telegramId, user);

  res.json({ success: true, reward: task.reward });
});

app.post('/api/wallet', authUser, (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });
  const user = db.getUser(req.telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.wallet_address = address;
  db.setUser(req.telegramId, user);
  res.json({ success: true, address });
});

app.post('/api/verify-wallet', authUser, (req, res) => {
  const settings = db.getSettings();
  if (!settings.wallet_verification_enabled) {
    return res.status(400).json({ error: 'Wallet verification is currently disabled' });
  }
  const user = db.getUser(req.telegramId);
  if (!user || !user.wallet_address) return res.status(400).json({ error: 'Connect wallet first' });
  // Production: verify real on-chain 0.05 TON transfer. This endpoint only marks verified after you confirm off-chain.
  // We do NOT fake blockchain success here.
  user.wallet_verified = 1;
  user.wallet_verified_at = Date.now();
  db.setUser(req.telegramId, user);
  res.json({ success: true, verified: true, note: 'In production this must be confirmed by on-chain indexer' });
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
  res.json(db.getReferrals(req.telegramId));
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
    verification_fee_ton: s.verification_fee_ton,
    channel_link: s.channel_link,
    youtube_link: s.youtube_link,
    x_link: s.x_link,
    checkin_rewards: s.checkin_rewards,
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
  const users = db.getAllUsers().map(u => ({
    telegram_id: u.telegram_id,
    username: u.username,
    first_name: u.first_name,
    balance: u.balance,
    total_mined: u.total_mined,
    level: u.level,
    status: u.status || 'active',
    wallet_address: u.wallet_address,
    wallet_verified: !!u.wallet_verified,
    created_at: u.created_at,
    last_claim: u.last_claim
  }));
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
    'channel_link', 'youtube_link', 'x_link',
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

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.listen(PORT, () => {
  console.log(`TAC PROTOCOL server on http://localhost:${PORT}`);
  console.log(`Admin IDs configured: ${ADMIN_IDS.length ? ADMIN_IDS.join(', ') : '(none — set ADMIN_TELEGRAM_IDS)'}`);
});
