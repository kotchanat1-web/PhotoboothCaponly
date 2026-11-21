// Register a booth and print its key ONCE (only the SHA-256 is stored on the server — ADM-7).
//   node scripts/add-booth.mjs <boothId> "<name>" --local | --remote
// Put the printed boothId/boothKey in the booth's local.json (never in git).
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [boothId, name, where] = process.argv.slice(2)
if (!boothId || !/^[A-Za-z0-9_-]{1,64}$/.test(boothId) || !name || !['--local', '--remote'].includes(where ?? '')) {
  console.error('usage: node scripts/add-booth.mjs <boothId: A-Z a-z 0-9 _ -> "<name>" --local|--remote')
  process.exit(1)
}
const key = randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(key).digest('hex')
const esc = (s) => s.replace(/'/g, "''")
const sql = `INSERT INTO booths (id, name, key_hash, active, created_at) VALUES ('${esc(boothId)}', '${esc(name)}', '${hash}', 1, '${new Date().toISOString()}')`
// run wrangler's JS entry with this node (no shell → the SQL is passed as one argument on Windows too)
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'photobooth', where, '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] })

console.log('\nBooth registered. Copy into the booth local.json (this key is shown only once):\n')
console.log(JSON.stringify({ payment: { provider: 'server', server: { boothId, boothKey: key } } }, null, 2))
