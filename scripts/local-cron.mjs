// Local stand-in for a hosted cron: pings the automation and flow cron
// routes every minute so `wait` steps and flow timeouts resume while
// running `npm run dev` / `npm start` on this machine.
//
// Usage: node scripts/local-cron.mjs   (BASE_URL defaults to http://localhost:3000)
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)

const secret = env.AUTOMATION_CRON_SECRET
if (!secret) {
  console.error('AUTOMATION_CRON_SECRET is missing from .env.local')
  process.exit(1)
}

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'
const routes = ['/api/automations/cron', '/api/flows/cron']
const intervalMs = 60_000

async function tick() {
  for (const route of routes) {
    try {
      const res = await fetch(baseUrl + route, { headers: { 'x-cron-secret': secret } })
      const body = await res.text()
      console.log(`${new Date().toISOString()} ${route} -> ${res.status} ${body.slice(0, 200)}`)
    } catch (err) {
      console.log(`${new Date().toISOString()} ${route} -> unreachable (${err.message})`)
    }
  }
}

await tick()
setInterval(tick, intervalMs)
