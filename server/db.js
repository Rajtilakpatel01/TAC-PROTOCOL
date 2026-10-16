const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

// Replace channel/youtube links via Admin panel or env after deploy
const DEFAULT_SETTINGS = {
  min_withdrawal: 10,
  withdrawal_fee: 2,
  referral_bonus: 50,
  referral_commission_pct: 10,
  wallet_verification_enabled: true,
  verification_fee_ton: 0.2,
  treasury_address: '',
  channel_1_link: 'https://t.me/tacprotocolxnvdax',
  channel_1_chat_id: '@tacprotocolxnvdax',
  channel_2_link: 'https://t.me/onlylegit_official',
  channel_2_chat_id: '@onlylegit_official',
  youtube_link: 'https://youtube.com/@rajtilakeditz',
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
    {
      id: 'join_channel_1',
      name: 'Join TAC Protocol Channel',
      type: 'telegram_channel',
      reward: 5,
      cooldown: 86400,
      enabled: true,
      link: 'https://t.me/tacprotocolxnvdax',
      chat_id: '@tacprotocolxnvdax'
    },
    {
      id: 'join_channel_2',
      name: 'Join OnlyLegit Official',
      type: 'telegram_channel',
      reward: 5,
      cooldown: 86400,
      enabled: true,
      link: 'https://t.me/onlylegit_official',
      chat_id: '@onlylegit_official'
    },
    {
      id: 'youtube_subscribe',
      name: 'Subscribe Raj Tilak Editz on YouTube',
      type: 'youtube',
      reward: 5,
      cooldown: 86400,
      enabled: true,
      link: 'https://www.youtube.com/@rajtilakeditz'
    }
  ]
};

const REMOVED_TASK_IDS = new Set([
  'follow_x', 'like_retweet', 'subscribe_channel', 'watch_youtube', 'react_post'
]);

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
      if (!raw.payments) raw.payments = [];
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
    payments: [],
    settings: { ...DEFAULT_SETTINGS }
  };
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let data = load();

function normalizeSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  s.verification_fee_ton = 0.2;
  // Force official defaults if placeholders remain
  if (!s.channel_1_link || s.channel_1_link.includes('YOUR_CHANNEL')) {
    s.channel_1_link = DEFAULT_SETTINGS.channel_1_link;
    s.channel_1_chat_id = DEFAULT_SETTINGS.channel_1_chat_id;
  }
  if (!s.channel_2_link || s.channel_2_link.includes('YOUR_CHANNEL')) {
    s.channel_2_link = DEFAULT_SETTINGS.channel_2_link;
    s.channel_2_chat_id = DEFAULT_SETTINGS.channel_2_chat_id;
  }
  if (!s.youtube_link || s.youtube_link.includes('YOUR_CHANNEL')) {
    s.youtube_link = DEFAULT_SETTINGS.youtube_link;
  }

  // Drop X/Twitter and legacy task ids
  let tasks = Array.isArray(s.tasks) ? s.tasks.filter(t => t && !REMOVED_TASK_IDS.has(t.id)) : [];
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  // Ensure required tasks exist
  for (const def of DEFAULT_SETTINGS.tasks) {
    if (!byId[def.id]) {
      tasks.push({ ...def });
    } else {
      // Keep admin edits but ensure type/fields for verification
      byId[def.id].type = byId[def.id].type || def.type;
      if (def.type === 'telegram_channel') {
        byId[def.id].chat_id = byId[def.id].chat_id || def.chat_id;
        byId[def.id].link = byId[def.id].link || def.link;
      }
      if (def.type === 'youtube') {
        byId[def.id].link = byId[def.id].link || def.link;
      }
    }
  }
  // Re-sync links from top-level settings if admin set them
  tasks = tasks.map(t => {
    if (t.id === 'join_channel_1') {
      return {
        ...t,
        type: 'telegram_channel',
        link: s.channel_1_link || t.link,
        chat_id: s.channel_1_chat_id || t.chat_id
      };
    }
    if (t.id === 'join_channel_2') {
      return {
        ...t,
        type: 'telegram_channel',
        link: s.channel_2_link || t.link,
        chat_id: s.channel_2_chat_id || t.chat_id
      };
    }
    if (t.id === 'youtube_subscribe') {
      return {
        ...t,
        type: 'youtube',
        link: s.youtube_link || t.link
      };
    }
    return t;
  });
  s.tasks = tasks;
  delete s.x_link;
  return s;
}

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
  hasCompletedTask(telegramId, taskId) {
    return data.tasks.some(t => t.telegram_id === String(telegramId) && t.task_id === taskId);
  },
  getCompletedTaskIds(telegramId) {
    return [...new Set(
      data.tasks
        .filter(t => t.telegram_id === String(telegramId))
        .map(t => t.task_id)
    )];
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
    if (data.referrals.find(r => r.referred_id === String(referredId))) {
      return false; // already referred by someone
    }
    data.referrals.push({
      referrer_id: String(referrerId),
      referred_id: String(referredId),
      commission_earned: 0,
      created_at: Date.now()
    });
    save(data);
    return true;
  },
  getReferrals(referrerId) {
    return data.referrals.filter(r => r.referrer_id === String(referrerId));
  },
  findByReferralCode(code) {
    if (!code) return null;
    const c = String(code).trim().toUpperCase();
    return Object.values(data.users).find(u => String(u.referral_code || '').toUpperCase() === c) || null;
  },
  getSettings() {
    return normalizeSettings(data.settings || {});
  },
  setSettings(partial) {
    data.settings = normalizeSettings({ ...data.settings, ...partial });
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
      total_claims: data.claims.length,
      total_referrals: data.referrals.length,
      total_task_completions: data.tasks.length
    };
  },
  findPaymentByTx(txHash) {
    if (!data.payments) data.payments = [];
    return data.payments.find(p => p.tx_hash === txHash) || null;
  },
  addPayment(record) {
    if (!data.payments) data.payments = [];
    data.payments.push({ ...record, recorded_at: Date.now() });
    save(data);
  },
  getTaskCompletionsForUser(telegramId) {
    return data.tasks.filter(t => t.telegram_id === String(telegramId));
  },
  getReferralDetails(referrerId) {
    const refs = data.referrals.filter(r => r.referrer_id === String(referrerId));
    return refs.map(r => {
      const u = data.users[r.referred_id] || null;
      const completions = data.tasks.filter(t => t.telegram_id === String(r.referred_id));
      const taskIds = [...new Set(completions.map(c => c.task_id))];
      return {
        referred_id: r.referred_id,
        created_at: r.created_at,
        commission_earned: r.commission_earned || 0,
        first_name: u ? u.first_name : null,
        username: u ? u.username : null,
        wallet_verified: u ? !!u.wallet_verified : false,
        payment_tx: u ? (u.payment_tx_hash || null) : null,
        wallet_address: u ? u.wallet_address : null,
        joined_at: u ? u.created_at : r.created_at,
        tasks_completed: taskIds,
        task_count: taskIds.length
      };
    });
  }
};
