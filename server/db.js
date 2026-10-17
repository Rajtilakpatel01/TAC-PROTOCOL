const fs = require('fs');
const path = require('path');

/**
 * Resolve a writable directory for data.json.
 * Prefer DATA_PATH / RENDER_DISK_PATH when the path is actually writable
 * (Render Persistent Disk must be mounted). Otherwise fall back to server folder
 * so the app still boots instead of crashing with ENOENT on /var/data.
 */
function resolveDataDir() {
  const candidates = [];
  if (process.env.DATA_PATH) candidates.push(process.env.DATA_PATH);
  if (process.env.RENDER_DISK_PATH) candidates.push(process.env.RENDER_DISK_PATH);
  candidates.push(path.join(__dirname, 'data'));
  candidates.push(__dirname);

  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Prove we can write (avoids ENOENT / EACCES later)
      const probe = path.join(dir, '.tac_write_test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch (e) {
      console.warn('[db] not writable:', dir, e.code || e.message);
    }
  }
  // Last resort — still __dirname
  return __dirname;
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'data.json');
console.log('[db] DATA_DIR=', DATA_DIR, 'DB_PATH=', DB_PATH);
if (process.env.DATA_PATH && DATA_DIR !== process.env.DATA_PATH) {
  console.warn(
    '[db] DATA_PATH=' + process.env.DATA_PATH +
    ' is not writable (disk not mounted?). Using fallback:', DATA_DIR
  );
}

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
  honor_system_youtube: true,
  bot_username: '',
  mini_app_path: '',
  app_public_url: '',
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
      const text = fs.readFileSync(DB_PATH, 'utf8');
      if (!text || !text.trim()) {
        console.warn('[db] data.json empty — using defaults (will not wipe if save fails)');
      } else {
        const raw = JSON.parse(text);
        // Merge shape only — never delete existing collections
        if (!raw.settings) raw.settings = { ...DEFAULT_SETTINGS };
        if (!raw.users) raw.users = {};
        if (!raw.claims) raw.claims = [];
        if (!raw.tasks) raw.tasks = [];
        if (!raw.withdrawals) raw.withdrawals = [];
        if (!raw.referrals) raw.referrals = [];
        if (!raw.payments) raw.payments = [];
        return raw;
      }
    }
  } catch (e) {
    console.error('[db] load error', e.message);
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
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic-ish write: write temp then rename (best-effort)
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, DB_PATH);
    } catch (_) {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  } catch (e) {
    console.error('[db] save failed', DB_PATH, e.message);
    throw e;
  }
}

function ensureDbFile() {
  if (fs.existsSync(DB_PATH)) return;
  const empty = {
    users: {},
    claims: [],
    tasks: [],
    withdrawals: [],
    referrals: [],
    payments: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  try {
    save(empty);
    console.log('[db] initialized new data.json at', DB_PATH);
  } catch (e) {
    console.error('[db] could not create data.json', e.message);
  }
}

ensureDbFile();
let data = load();
// If load returned empty defaults but file was missing and still can't write, keep in-memory
try {
  if (!fs.existsSync(DB_PATH)) save(data);
} catch (e) {
  console.error('[db] initial persist skipped', e.message);
}

function normalizeSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  s.verification_fee_ton = 0.2;
  // Never drop a saved treasury address
  if (settings && settings.treasury_address) {
    s.treasury_address = String(settings.treasury_address).trim();
  }
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
    const current = data.settings || {};
    const merged = { ...current, ...partial };
    // If client omits treasury_address, keep existing
    if (partial.treasury_address === undefined) {
      merged.treasury_address = current.treasury_address || '';
    } else {
      merged.treasury_address = String(partial.treasury_address || '').trim();
    }
    // Same for other critical string fields omitted accidentally
    for (const k of ['bot_username', 'channel_1_link', 'channel_1_chat_id', 'channel_2_link', 'channel_2_chat_id', 'youtube_link', 'app_public_url']) {
      if (partial[k] === undefined && current[k] != null) merged[k] = current[k];
    }
    data.settings = normalizeSettings(merged);
    save(data);
    console.log('[db] settings saved, treasury=', data.settings.treasury_address ? data.settings.treasury_address.slice(0, 10) + '…' : '(empty)');
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
  getPayments(limit = 100) {
    if (!data.payments) data.payments = [];
    return [...data.payments].reverse().slice(0, limit);
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
    const rid = String(referrerId);
    // Merge edge table + users.referred_by (self-heal if table row missing)
    const byId = {};
    for (const r of data.referrals) {
      if (String(r.referrer_id) === rid) {
        byId[String(r.referred_id)] = r;
      }
    }
    for (const u of Object.values(data.users)) {
      if (String(u.referred_by) === rid) {
        const id = String(u.telegram_id);
        if (!byId[id]) {
          byId[id] = {
            referrer_id: rid,
            referred_id: id,
            commission_earned: 0,
            created_at: u.created_at || Date.now()
          };
        }
      }
    }
    return Object.values(byId).map(r => {
      const u = data.users[String(r.referred_id)] || null;
      const completions = data.tasks.filter(t => t.telegram_id === String(r.referred_id));
      const taskIds = [...new Set(completions.map(c => c.task_id))];
      return {
        referred_id: String(r.referred_id),
        created_at: r.created_at,
        commission_earned: r.commission_earned || 0,
        first_name: u ? u.first_name : null,
        username: u ? u.username : null,
        wallet_verified: u ? !!u.wallet_verified : false,
        payment_tx: u ? (u.payment_tx_hash || null) : null,
        payment_pending: u && u.wallet_address && !u.wallet_verified,
        wallet_address: u ? u.wallet_address : null,
        joined_at: u ? u.created_at : r.created_at,
        tasks_completed: taskIds,
        task_count: taskIds.length,
        channel1_ok: !!(u && u.channel1_ok) || taskIds.includes('join_channel_1'),
        channel2_ok: !!(u && u.channel2_ok) || taskIds.includes('join_channel_2'),
        both_channels: (!!(u && u.channel1_ok) || taskIds.includes('join_channel_1')) && (!!(u && u.channel2_ok) || taskIds.includes('join_channel_2'))
      };
    }).sort((a, b) => (b.joined_at || 0) - (a.joined_at || 0));
  }
};
