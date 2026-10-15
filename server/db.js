const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

const DEFAULT_SETTINGS = {
  min_withdrawal: 10,
  withdrawal_fee: 2,
  referral_bonus: 50,
  referral_commission_pct: 10,
  wallet_verification_enabled: true,
  verification_fee_ton: 0.05,
  treasury_address: '',
  channel_link: 'https://t.me/tacprotocol',
  youtube_link: 'https://youtube.com/@tacprotocol',
  x_link: 'https://x.com/tacprotocol',
  mining_base_power: 0.05,
  mining_level_multiplier: 0.04,
  level_thresholds: [
    0, 10, 25, 50, 100, 150, 200, 300, 400, 500,
    650, 800, 1000, 1200, 1500, 1800, 2200, 2600, 3000, 3500,
    4000, 4500, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 14000,
    16000, 18000, 20000, 25000, 30000, 35000, 40000, 50000, 60000, 75000, 100000
  ],
  checkin_rewards: [5, 6, 7, 8, 9, 10, 15],
  tasks: [
    { id: 'subscribe_channel', name: 'Subscribe TAC Channel', reward: 5, cooldown: 86400, enabled: true, link: '' },
    { id: 'follow_x', name: 'Follow TAC on X', reward: 5, cooldown: 43200, enabled: true, link: '' },
    { id: 'watch_youtube', name: 'Watch TAC Miner YouTube', reward: 5, cooldown: 43200, enabled: true, link: '' },
    { id: 'react_post', name: 'React on Latest post', reward: 5, cooldown: 10800, enabled: true, link: '' },
    { id: 'like_retweet', name: 'Like & Retweet on X', reward: 5, cooldown: 21600, enabled: true, link: '' }
  ]
};

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!raw.settings) raw.settings = { ...DEFAULT_SETTINGS };
      if (!raw.users) raw.users = {};
      if (!raw.claims) raw.claims = [];
      if (!raw.tasks) raw.tasks = [];
      if (!raw.withdrawals) raw.withdrawals = [];
      if (!raw.referrals) raw.referrals = [];
      return raw;
    }
  } catch (e) {
    console.error('DB load error', e.message);
  }
  return {
    users: {},
    claims: [],
    tasks: [],
    withdrawals: [],
    referrals: [],
    settings: { ...DEFAULT_SETTINGS }
  };
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let data = load();

module.exports = {
  getUser(id) {
    return data.users[String(id)] || null;
  },
  setUser(id, user) {
    data.users[String(id)] = user;
    save(data);
  },
  getAllUsers() {
    return Object.values(data.users);
  },
  addClaim(telegramId, amount) {
    data.claims.push({ telegram_id: String(telegramId), amount, claimed_at: Date.now() });
    save(data);
  },
  getClaims(limit = 100) {
    return data.claims.slice(-limit).reverse();
  },
  addTaskCompletion(telegramId, taskId, reward) {
    data.tasks.push({ telegram_id: String(telegramId), task_id: taskId, reward, completed_at: Date.now() });
    save(data);
  },
  getRecentTask(telegramId, taskId) {
    return data.tasks
      .filter(t => t.telegram_id === String(telegramId) && t.task_id === taskId)
      .sort((a, b) => b.completed_at - a.completed_at)[0];
  },
  addWithdrawal(w) {
    const entry = { ...w, id: data.withdrawals.length + 1, created_at: Date.now() };
    data.withdrawals.push(entry);
    save(data);
    return entry;
  },
  getWithdrawals(telegramId) {
    return data.withdrawals.filter(w => w.telegram_id === String(telegramId)).reverse().slice(0, 20);
  },
  getAllWithdrawals() {
    return [...data.withdrawals].reverse();
  },
  updateWithdrawal(id, updates) {
    const w = data.withdrawals.find(x => x.id === Number(id));
    if (!w) return null;
    Object.assign(w, updates);
    save(data);
    return w;
  },
  addReferral(referrerId, referredId) {
    if (!data.referrals.find(r => r.referred_id === String(referredId))) {
      data.referrals.push({
        referrer_id: String(referrerId),
        referred_id: String(referredId),
        commission_earned: 0,
        created_at: Date.now()
      });
      save(data);
    }
  },
  getReferrals(referrerId) {
    return data.referrals.filter(r => r.referrer_id === String(referrerId));
  },
  findByReferralCode(code) {
    return Object.values(data.users).find(u => u.referral_code === code);
  },
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...data.settings };
  },
  setSettings(partial) {
    data.settings = { ...data.settings, ...partial };
    save(data);
    return data.settings;
  },
  getStats() {
    const users = Object.values(data.users);
    const now = Date.now();
    const dayAgo = now - 86400000;
    return {
      total_users: users.length,
      active_miners: users.filter(u => (u.last_mine_start || 0) > dayAgo || (u.last_claim || 0) > dayAgo).length,
      total_balance: users.reduce((s, u) => s + (u.balance || 0), 0),
      total_mined: users.reduce((s, u) => s + (u.total_mined || 0), 0),
      pending_withdrawals: data.withdrawals.filter(w => w.status === 'pending').length,
      pending_withdrawal_amount: data.withdrawals
        .filter(w => w.status === 'pending')
        .reduce((s, w) => s + (w.amount || 0), 0),
      verified_wallets: users.filter(u => u.wallet_verified).length,
      total_claims: data.claims.length
    };
  }
};
