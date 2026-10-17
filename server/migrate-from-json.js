/**
 * One-time safe JSON → PostgreSQL migration.
 *
 * Usage on Render Shell / local:
 *   DATABASE_URL=postgres://... node server/migrate-from-json.js /path/to/data.json
 *
 * Rules:
 * - Does NOT delete PostgreSQL data
 * - Does NOT overwrite existing users (same telegram_id)
 * - Only adds missing users / records
 * - Fills empty settings (e.g. treasury) from JSON when PG field is empty
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const dbUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
  if (!dbUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const file = process.argv[2] || process.env.MIGRATE_JSON_PATH;
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node server/migrate-from-json.js /path/to/data.json');
    console.error('File not found:', file || '(none)');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const jsonUsers = Object.keys(raw.users || {}).length;
  console.log('[migrate] source', file, 'users=', jsonUsers);

  const db = require('./db');
  await db.ready();
  if (db.getMode() !== 'postgres') {
    console.error('[migrate] Not in postgres mode. Abort.');
    process.exit(1);
  }

  // Re-use merge via setUser for missing only
  const before = db.getAllUsers().length;
  let added = 0;
  for (const [id, u] of Object.entries(raw.users || {})) {
    if (!db.getUser(id)) {
      db.setUser(id, u);
      added++;
    }
  }

  // Settings: only fill empty
  const cur = db.getSettings();
  const js = raw.settings || {};
  const patch = {};
  for (const [k, v] of Object.entries(js)) {
    if (v === undefined || v === null || v === '') continue;
    if (cur[k] === undefined || cur[k] === null || cur[k] === '') patch[k] = v;
  }
  if (Object.keys(patch).length) {
    db.setSettings(patch);
    console.log('[migrate] settings filled keys:', Object.keys(patch).join(', '));
  }

  // Referrals / tasks / payments arrays — go through internal merge by re-calling
  // export a merge function? Use raw SQL via requiring pool is hard.
  // For arrays, call low-level: we add via existing APIs when possible
  for (const r of raw.referrals || []) {
    if (r.referrer_id && r.referred_id) db.addReferral(r.referrer_id, r.referred_id);
  }
  for (const t of raw.tasks || []) {
    if (t.telegram_id && t.task_id && !db.hasCompletedTask(t.telegram_id, t.task_id)) {
      db.addTaskCompletion(t.telegram_id, t.task_id, t.reward || 0);
    }
  }
  for (const p of raw.payments || []) {
    if (p.tx_hash && !db.findPaymentByTx(p.tx_hash)) db.addPayment(p);
  }

  // Wait for persist queue
  await new Promise(r => setTimeout(r, 1500));
  const after = db.getAllUsers().length;
  console.log('[migrate] done. users before=', before, 'added=', added, 'after=', after);
  console.log('[migrate] JSON file was NOT deleted:', file);
  process.exit(0);
}

main().catch(e => {
  console.error('[migrate] failed', e);
  process.exit(1);
});
