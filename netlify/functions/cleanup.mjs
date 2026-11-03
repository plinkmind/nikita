// Scheduled clean-up (every hour): removes expired results (guests after 24 h, accounts after RESULT_RETENTION_DAYS),
// uploaded photos left behind, try-ons that never finished, old rate-limit counters and expired sessions.
import { getApp } from '../../backend/src/app.js'

export default async () => {
  const stats = await (await getApp()).cleanup()
  console.log('[cleanup]', JSON.stringify(stats))
  return new Response(null, { status: 204 })
}

export const config = { schedule: '@hourly' }
