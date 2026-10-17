const fs = require('fs');
const path = require('path');

// ---------- defaults (shared) ----------
const DEFAULT_SETTINGS = {
  min_withdrawal: 10,
  withdrawal_fee: 2,
  referral_bonus: 5,
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
  ad_reward_enabled: true,
  ad_reward_tac: 1,
  ad_reward_cooldown_sec: 120,
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

function emptyPayload() {
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

function normalizeSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  s.verification_fee_ton = 0.2;
  if (settings && settings.treasury_address) {
    s.treasury_address = String(settings.treasury_address).trim();
  }
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

  let tasks = Array.isArray(s.tasks) ? s.tasks.filter(t => t && !REMOVED_TASK_IDS.has(t.id)) : [];
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  for (const def of DEFAULT_SETTINGS.tasks) {
    if (!byId[def.id]) {
      tasks.push({ ...def });
    } else {
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
      return { ...t, type: 'youtube', link: s.youtube_link || t.link };
    }
    return t;
  });
  s.tasks = tasks;
  delete s.x_link;
  return s;
}

// ---------- JSON file backend (fallback when no DATABASE_URL) ----------
function resolveDataDir() {
  const candidates = [];
  if (process.env.DATA_PATH) candidates.push(process.env.DATA_PATH);
  if (process.env.RENDER_DISK_PATH) candidates.push(process.env.RENDER_DISK_PATH);
  candidates.push(path.join(__dirname, 'data'));
  candidates.push(__dirname);
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.tac_write_test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch (e) {
      console.warn('[db] not writable:', dir, e.code || e.message);
    }
  }
  return __dirname;
}

function findExistingJsonFiles() {
  const paths = [];
  const dirs = [
    process.env.DATA_PATH,
    process.env.RENDER_DISK_PATH,
    path.join(__dirname, 'data'),
    __dirname,
    '/opt/render/project/src/server',
    '/opt/render/project/src/server/data',
    path.join(process.cwd(), 'server'),
    path.join(process.cwd(), 'server', 'data'),
    process.cwd()
  ].filter(Boolean);
  const seen = new Set();
  for (const dir of dirs) {
    try {
      const fp = path.join(dir, 'data.json');
      if (seen.has(fp)) continue;
      seen.add(fp);
      if (fs.existsSync(fp)) paths.push(fp);
    } catch (_) {}
  }
  return paths;
}

function loadJsonFromDisk(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text || !text.trim()) return null;
    const raw = JSON.parse(text);
    if (!raw.users) raw.users = {};
    if (!raw.claims) raw.claims = [];
    if (!raw.tasks) raw.tasks = [];
    if (!raw.withdrawals) raw.withdrawals = [];
    if (!raw.referrals) raw.referrals = [];
    if (!raw.payments) raw.payments = [];
    if (!raw.settings) raw.settings = { ...DEFAULT_SETTINGS };
    return raw;
  } catch (e) {
    console.error('[db] JSON load error', filePath, e.message);
    return null;
  }
}

// ---------- shared in-memory state ----------
let data = emptyPayload();
let persistMode = 'memory'; // 'postgres' | 'json' | 'memory'
let dbPath = null;
let pgPool = null;
let readyPromise = null;
let saveQueue = Promise.resolve();

function scheduleSave() {
  if (persistMode === 'memory') return;
  saveQueue = saveQueue.then(() => persistNow()).catch(e => {
    console.error('[db] persist error', e.message);
  });
}

async function persistNow() {
  if (persistMode === 'postgres' && pgPool) {
    await pgPool.query(
      `INSERT INTO app_state (id, payload, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [JSON.stringify(data)]
    );
    return;
  }
  if (persistMode === 'json' && dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, dbPath);
    } catch (_) {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }
}

function save() {
  scheduleSave();
}

function normalizePayload(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  if (!d.users) d.users = {};
  if (!d.claims) d.claims = [];
  if (!d.tasks) d.tasks = [];
  if (!d.withdrawals) d.withdrawals = [];
  if (!d.referrals) d.referrals = [];
  if (!d.payments) d.payments = [];
  if (!d.settings) d.settings = { ...DEFAULT_SETTINGS };
  return d;
}

/** Merge JSON into PG payload without deleting existing PG users/settings */
function mergePayload(pgData, jsonData) {
  const base = normalizePayload(pgData);
  const inc = normalizePayload(jsonData);
  // Users: keep existing PG user; add missing from JSON only
  for (const [id, u] of Object.entries(inc.users || {})) {
    if (!base.users[id]) base.users[id] = u;
  }
  // Arrays: append items that look unique
  const claimKey = c => (c.telegram_id || '') + ':' + (c.at || '') + ':' + (c.amount || '');
  const existingClaims = new Set((base.claims || []).map(claimKey));
  for (const c of inc.claims || []) {
    if (!existingClaims.has(claimKey(c))) base.claims.push(c);
  }
  const taskKey = t => (t.telegram_id || '') + ':' + (t.task_id || '') + ':' + (t.at || '');
  const existingTasks = new Set((base.tasks || []).map(taskKey));
  for (const t of inc.tasks || []) {
    if (!existingTasks.has(taskKey(t))) base.tasks.push(t);
  }
  const refKey = r => (r.referrer_id || '') + '>' + (r.referred_id || '');
  const existingRefs = new Set((base.referrals || []).map(refKey));
  for (const r of inc.referrals || []) {
    if (!existingRefs.has(refKey(r))) base.referrals.push(r);
  }
  const payKey = p => p.tx_hash || '';
  const existingPay = new Set((base.payments || []).map(payKey));
  for (const p of inc.payments || []) {
    if (p.tx_hash && !existingPay.has(p.tx_hash)) base.payments.push(p);
  }
  const wdIds = new Set((base.withdrawals || []).map(w => w.id));
  for (const w of inc.withdrawals || []) {
    if (w.id && !wdIds.has(w.id)) base.withdrawals.push(w);
  }
  // Settings: fill empty fields from JSON (never wipe treasury if PG has it)
  const bs = base.settings || {};
  const is = inc.settings || {};
  for (const [k, v] of Object.entries(is)) {
    if (bs[k] === undefined || bs[k] === null || bs[k] === '') {
      if (v !== undefined && v !== null && v !== '') bs[k] = v;
    }
  }
  if (!bs.treasury_address && is.treasury_address) {
    bs.treasury_address = is.treasury_address;
  }
  base.settings = bs;
  return base;
}

async function initPostgres(databaseUrl) {
  let Pool;
  try {
    Pool = require('pg').Pool;
  } catch (e) {
    throw new Error(
      'pg package not installed. Add dependency "pg" and run npm install. ' + (e.message || '')
    );
  }
  pgPool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  });

  // Verify connection
  await pgPool.query('SELECT 1');
  console.log('[db] PostgreSQL connection OK');

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      payload jsonb NOT NULL,
      updated_at timestamptz DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS migration_log (
      id serial PRIMARY KEY,
      source_path text,
      users_imported integer DEFAULT 0,
      note text,
      created_at timestamptz DEFAULT NOW()
    );
  `);

  const res = await pgPool.query('SELECT payload FROM app_state WHERE id = 1');
  let pgPayload = null;
  if (res.rows.length && res.rows[0].payload) {
    pgPayload = normalizePayload(
      typeof res.rows[0].payload === 'string'
        ? JSON.parse(res.rows[0].payload)
        : res.rows[0].payload
    );
    console.log('[db] PostgreSQL has existing data users=', Object.keys(pgPayload.users).length);
  }

  // Always scan JSON for one-time safe merge / import (never delete JSON file)
  const jsonFiles = findExistingJsonFiles();
  console.log('[db] JSON candidates:', jsonFiles.length ? jsonFiles.join(' | ') : '(none)');
  let bestJson = null;
  let bestPath = null;
  for (const f of jsonFiles) {
    const j = loadJsonFromDisk(f);
    if (!j) continue;
    const n = Object.keys(j.users || {}).length;
    if (!bestJson || n > Object.keys(bestJson.users || {}).length) {
      bestJson = j;
      bestPath = f;
    }
  }

  if (pgPayload && Object.keys(pgPayload.users).length > 0) {
    data = pgPayload;
    if (bestJson && Object.keys(bestJson.users || {}).length > 0) {
      const before = Object.keys(data.users).length;
      data = mergePayload(data, bestJson);
      const after = Object.keys(data.users).length;
      if (after > before) {
        console.log('[db] merged missing JSON users into PG:', before, '→', after, 'from', bestPath);
        await pgPool.query(
          `INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [JSON.stringify(data)]
        );
        await pgPool.query(
          `INSERT INTO migration_log (source_path, users_imported, note) VALUES ($1,$2,$3)`,
          [bestPath, after - before, 'merge missing users from JSON into existing PG']
        );
      }
    }
  } else if (bestJson) {
    data = normalizePayload(bestJson);
    console.log('[db] migrating JSON → PostgreSQL from', bestPath, 'users=', Object.keys(data.users).length);
    await pgPool.query(
      `INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [JSON.stringify(data)]
    );
    await pgPool.query(
      `INSERT INTO migration_log (source_path, users_imported, note) VALUES ($1,$2,$3)`,
      [bestPath, Object.keys(data.users).length, 'full import from JSON (PG was empty)']
    );
  } else {
    data = emptyPayload();
    await pgPool.query(
      `INSERT INTO app_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(data)]
    );
    console.log('[db] PostgreSQL initialized empty (no JSON to import)');
  }

  persistMode = 'postgres';
  // Ensure treasury env lock applied in memory settings object
  data.settings = data.settings || {};
}

function initJson() {
  const dir = resolveDataDir();
  dbPath = path.join(dir, 'data.json');
  console.log('[db] JSON mode path=', dbPath);
  if (process.env.DATA_PATH && dir !== process.env.DATA_PATH) {
    console.warn('[db] DATA_PATH not writable; fallback', dir);
  }
  const existing = loadJsonFromDisk(dbPath);
  if (existing) {
    data = existing;
  } else {
    // try other locations
    for (const f of findExistingJsonFiles()) {
      const j = loadJsonFromDisk(f);
      if (j) {
        data = j;
        console.log('[db] recovered JSON from', f);
        break;
      }
    }
  }
  persistMode = 'json';
  try {
    save();
  } catch (e) {
    console.error('[db] initial JSON save failed', e.message);
    persistMode = 'memory';
  }
}

/**
 * Must be awaited before accepting traffic when using PostgreSQL.
 */
function resolveDatabaseUrl() {
  // Support common aliases / accidental whitespace / quoted values from Render UI
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_CONNECTION ||
    process.env.DB_URL ||
    '';
  let url = String(raw).trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  return url;
}

function ready() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    console.log('[db] TAC-PG-v2 starting…');
    const url = resolveDatabaseUrl();
    console.log(
      '[db] DATABASE_URL',
      url ? ('SET (length=' + url.length + ', starts=' + url.slice(0, 12) + '…)') : 'NOT SET'
    );
    console.log(
      '[db] env keys sample:',
      Object.keys(process.env)
        .filter(k => /DATABASE|POSTGRES|DB_|DATA_PATH|RENDER/i.test(k))
        .sort()
        .join(', ') || '(none matched)'
    );

    if (url) {
      try {
        await initPostgres(url);
        console.log('[db] SUCCESS backend=PostgreSQL — JSON /var/data is NOT used for writes');
        return { mode: 'postgres', users: Object.keys(data.users).length };
      } catch (e) {
        console.error('[db] PostgreSQL FAILED:', e.message || e);
        // Do NOT fall back to JSON when user configured DATABASE_URL
        throw e;
      }
    }

    if (process.env.RENDER || process.env.RENDER_SERVICE_ID) {
      console.error(
        '[db] FATAL: Running on Render but DATABASE_URL is empty. ' +
          'Add DATABASE_URL on the WEB service (not only on the Postgres service), then Manual Deploy.'
      );
      throw new Error('DATABASE_URL missing on Render web service');
    }

    console.warn('[db] Local mode: no DATABASE_URL — using JSON file');
    initJson();
    return { mode: persistMode };
  })();
  return readyPromise;
}

// Do NOT auto-init at require-time (avoids racing before env is ready).
// index.js must await db.ready().

// ---------- public API (sync, same as before) ----------
/** Permanent treasury: env TREASURY_ADDRESS / TREASURY_WALLET locks the address for all users */
function getLockedTreasury(settingsObj) {
  const fromEnv = String(
    process.env.TREASURY_ADDRESS || process.env.TREASURY_WALLET || ''
  ).trim();
  const fromDb = String(
    (settingsObj && settingsObj.treasury_address) ||
      (data.settings && data.settings.treasury_address) ||
      ''
  ).trim();
  return fromEnv || fromDb;
}

module.exports = {
  ready,
  getMode: () => persistMode,
  getLockedTreasury: () => getLockedTreasury(),
  getUser(id) {
    return data.users[String(id)] || null;
  },
  setUser(id, user) {
    data.users[String(id)] = { ...user, telegram_id: String(id) };
    save();
  },
  getAllUsers() {
    return Object.values(data.users);
  },
  addClaim(telegramId, amount) {
    data.claims.push({ telegram_id: String(telegramId), amount, at: Date.now() });
    save();
  },
  getClaims(limit = 100) {
    return data.claims.slice(-limit).reverse();
  },
  addTaskCompletion(telegramId, taskId, reward) {
    data.tasks.push({
      telegram_id: String(telegramId),
      task_id: taskId,
      reward,
      at: Date.now()
    });
    save();
  },
  getRecentTask(telegramId, taskId) {
    return data.tasks
      .filter(t => t.telegram_id === String(telegramId) && t.task_id === taskId)
      .sort((a, b) => b.at - a.at)[0] || null;
  },
  hasCompletedTask(telegramId, taskId) {
    return data.tasks.some(t => t.telegram_id === String(telegramId) && t.task_id === taskId);
  },
  getCompletedTaskIds(telegramId) {
    return [
      ...new Set(
        data.tasks.filter(t => t.telegram_id === String(telegramId)).map(t => t.task_id)
      )
    ];
  },
  addWithdrawal(w) {
    const entry = {
      id: 'wd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      ...w,
      created_at: Date.now()
    };
    data.withdrawals.push(entry);
    save();
    return entry;
  },
  getWithdrawals(telegramId) {
    return data.withdrawals
      .filter(w => String(w.telegram_id) === String(telegramId))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  },
  getAllWithdrawals() {
    return [...data.withdrawals].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  },
  updateWithdrawal(id, updates) {
    const i = data.withdrawals.findIndex(w => w.id === id);
    if (i < 0) return null;
    data.withdrawals[i] = { ...data.withdrawals[i], ...updates };
    save();
    return data.withdrawals[i];
  },
  addReferral(referrerId, referredId) {
    const a = String(referrerId);
    const b = String(referredId);
    if (a === b) return false;
    const exists = data.referrals.some(
      r => r.referrer_id === a && r.referred_id === b
    );
    if (exists) return false;
    data.referrals.push({
      referrer_id: a,
      referred_id: b,
      commission_earned: 0,
      created_at: Date.now()
    });
    save();
    return true;
  },
  getReferrals(referrerId) {
    return data.referrals.filter(r => r.referrer_id === String(referrerId));
  },
  findByReferralCode(code) {
    if (!code) return null;
    const c = String(code).trim().toUpperCase();
    return (
      Object.values(data.users).find(
        u => String(u.referral_code || '').toUpperCase() === c
      ) || null
    );
  },

  getSettings() {
    const s = normalizeSettings(data.settings || {});
    s.treasury_address = getLockedTreasury(s);
    return s;
  },
  setSettings(partial) {
    const current = data.settings || {};
    const merged = { ...current, ...partial };
    const envTreasury = String(
      process.env.TREASURY_ADDRESS || process.env.TREASURY_WALLET || ''
    ).trim();
    if (envTreasury) {
      // Locked via env — always keep this address
      merged.treasury_address = envTreasury;
    } else if (partial.treasury_address === undefined) {
      merged.treasury_address = current.treasury_address || '';
    } else {
      const next = String(partial.treasury_address || '').trim();
      // Never replace a saved address with empty
      merged.treasury_address = next || current.treasury_address || '';
    }
    for (const k of [
      'bot_username',
      'channel_1_link',
      'channel_1_chat_id',
      'channel_2_link',
      'channel_2_chat_id',
      'youtube_link',
      'app_public_url'
    ]) {
      if (partial[k] === undefined && current[k] != null) merged[k] = current[k];
    }
    data.settings = normalizeSettings(merged);
    save();
    console.log(
      '[db] settings saved, treasury=',
      data.settings.treasury_address
        ? data.settings.treasury_address.slice(0, 10) + '…'
        : '(empty)'
    );
    return data.settings;
  },
  getStats() {
    const users = Object.values(data.users);
    const now = Date.now();
    const dayAgo = now - 86400000;
    return {
      total_users: users.length,
      active_miners: users.filter(
        u => (u.last_mine_start || 0) > dayAgo || (u.last_claim || 0) > dayAgo
      ).length,
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
    save();
  },
  getTaskCompletionsForUser(telegramId) {
    return data.tasks.filter(t => t.telegram_id === String(telegramId));
  },
  getReferralDetails(referrerId) {
    const rid = String(referrerId);
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
    return Object.values(byId)
      .map(r => {
        const u = data.users[String(r.referred_id)] || null;
        const completions = data.tasks.filter(
          t => t.telegram_id === String(r.referred_id)
        );
        const taskIds = [...new Set(completions.map(c => c.task_id))];
        return {
          referred_id: String(r.referred_id),
          created_at: r.created_at,
          commission_earned: r.commission_earned || 0,
          first_name: u ? u.first_name : null,
          username: u ? u.username : null,
          wallet_verified: u ? !!u.wallet_verified : false,
          payment_tx: u ? u.payment_tx_hash || null : null,
          payment_pending: u && u.wallet_address && !u.wallet_verified,
          wallet_address: u ? u.wallet_address : null,
          joined_at: u ? u.created_at : r.created_at,
          tasks_completed: taskIds,
          task_count: taskIds.length,
          channel1_ok: !!(u && u.channel1_ok) || taskIds.includes('join_channel_1'),
          channel2_ok: !!(u && u.channel2_ok) || taskIds.includes('join_channel_2'),
          both_channels:
            (!!(u && u.channel1_ok) || taskIds.includes('join_channel_1')) &&
            (!!(u && u.channel2_ok) || taskIds.includes('join_channel_2'))
        };
      })
      .sort((a, b) => (b.joined_at || 0) - (a.joined_at || 0));
  }
};
