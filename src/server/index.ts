import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { context, createServer, getServerPort, reddit, redis, settings } from '@devvit/web/server'
import type { TaskRequest, TaskResponse } from '@devvit/web/server'
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared'

const PAYLOAD_URL = 'https://www.galaxymovies.app/api/reddit-payload'
const LAST_POST_KEY = 'galaxymovies:last-broadcast-key'
const LAST_DEPARTURES_KEY = 'galaxymovies:last-departures-key'

type BroadcastKind = 'weekly' | 'leaving'

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

interface SubSettings {
  providers?: string[] | string
  post_day?: string
}

async function runBroadcast(manual = false, kind: BroadcastKind = 'weekly'): Promise<BroadcastResult> {
  const sub = await settings.getAll<SubSettings>().catch(() => ({}) as SubSettings)
  const postDay = String(sub.post_day ?? '1')
  if (kind === 'weekly' && !manual && String(new Date().getUTCDay()) !== postDay) {
    return { status: 'skipped', detail: 'not the configured post day' }
  }

  const raw = sub.providers
  const providers = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []
  const params = new URLSearchParams()
  if (providers.length) params.set('providers', providers.join(','))
  if (kind !== 'weekly') params.set('kind', kind)
  const query = params.toString()
  const resp = await fetch(query ? `${PAYLOAD_URL}?${query}` : PAYLOAD_URL).catch(() => null)
  if (!resp?.ok) return { status: 'failed', detail: `payload fetch ${resp?.status ?? 'network'}` }

  const payload = (await resp.json().catch(() => null)) as BroadcastPayload | null
  if (!payload?.title || !payload.text || !payload.key) {
    return { status: 'failed', detail: 'malformed payload' }
  }

  const dedupeKey = kind === 'leaving' ? LAST_DEPARTURES_KEY : LAST_POST_KEY
  if ((await redis.get(dedupeKey).catch(() => null)) === payload.key) {
    return { status: 'skipped', detail: `already posted this ${kind === 'leaving' ? 'month' : 'week'}` }
  }

  const subredditName = context.subredditName ?? 'galaxymovies'
  try {
    await reddit.submitPost({ subredditName, title: payload.title, text: payload.text })
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : 'submit failed' }
  }

  await redis.set(dedupeKey, payload.key).catch(() => {})
  return { status: 'posted' }
}

const app = new Hono()

app.post('/internal/scheduler/weekly-broadcast', async (c) => {
  await c.req.json<TaskRequest>().catch(() => null)
  const result = await runBroadcast()
  console.log('weekly-broadcast:', JSON.stringify(result))
  return c.json<TaskResponse>({ status: 'ok' }, 200)
})

const postNow = async (c: { json: (body: unknown, status: number) => Response }) => {
  const result = await runBroadcast(true)
  return c.json(result, result.status === 'failed' ? 500 : 200)
}

app.post('/external/post-now', postNow)
app.get('/external/post-now', postNow)

app.post('/internal/menu/post-now', async (c) => {
  await c.req.json<MenuItemRequest>().catch(() => null)
  const result = await runBroadcast(true)
  return c.json<UiResponse>(
    { showToast: `Broadcast ${result.status}${result.detail ? `: ${result.detail}` : ''}` },
    200
  )
})

app.post('/internal/scheduler/monthly-departures', async (c) => {
  await c.req.json<TaskRequest>().catch(() => null)
  const result = await runBroadcast(false, 'leaving')
  console.log('monthly-departures:', JSON.stringify(result))
  return c.json<TaskResponse>({ status: 'ok' }, 200)
})

app.post('/internal/menu/post-departures', async (c) => {
  await c.req.json<MenuItemRequest>().catch(() => null)
  const result = await runBroadcast(true, 'leaving')
  return c.json<UiResponse>(
    { showToast: `Departures ${result.status}${result.detail ? `: ${result.detail}` : ''}` },
    200
  )
})

serve({ fetch: app.fetch, createServer, port: getServerPort() })
