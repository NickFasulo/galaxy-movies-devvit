import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server'
import type { TaskRequest, TaskResponse } from '@devvit/web/server'
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared'

const PAYLOAD_URL = 'https://www.galaxymovies.app/api/reddit-payload'
const LAST_POST_KEY = 'galaxymovies:last-broadcast-key'

interface BroadcastPayload {
  title: string
  text: string
  url: string
  key: string
}

interface BroadcastResult {
  status: 'posted' | 'skipped' | 'failed'
  detail?: string
}

async function runBroadcast(): Promise<BroadcastResult> {
  const resp = await fetch(PAYLOAD_URL).catch(() => null)
  if (!resp?.ok) return { status: 'failed', detail: `payload fetch ${resp?.status ?? 'network'}` }

  const payload = (await resp.json().catch(() => null)) as BroadcastPayload | null
  if (!payload?.title || !payload.text || !payload.key) {
    return { status: 'failed', detail: 'malformed payload' }
  }

  if ((await redis.get(LAST_POST_KEY).catch(() => null)) === payload.key) {
    return { status: 'skipped', detail: 'already posted this week' }
  }

  const subredditName = context.subredditName ?? 'galaxymovies'
  try {
    await reddit.submitPost({ subredditName, title: payload.title, text: payload.text })
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : 'submit failed' }
  }

  await redis.set(LAST_POST_KEY, payload.key).catch(() => {})
  return { status: 'posted' }
}

const app = new Hono()

app.post('/internal/scheduler/weekly-broadcast', async (c) => {
  await c.req.json<TaskRequest>().catch(() => null)
  const result = await runBroadcast()
  console.log('weekly-broadcast:', JSON.stringify(result))
  return c.json<TaskResponse>({ status: 'ok' }, 200)
})

app.post('/internal/menu/post-now', async (c) => {
  await c.req.json<MenuItemRequest>().catch(() => null)
  const result = await runBroadcast()
  return c.json<UiResponse>(
    { showToast: `Broadcast ${result.status}${result.detail ? `: ${result.detail}` : ''}` },
    200
  )
})

serve({ fetch: app.fetch, createServer, port: getServerPort() })
