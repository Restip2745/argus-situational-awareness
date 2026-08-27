import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import { Ollama } from 'ollama'
import { readFileSync } from 'fs'
import { join } from 'path'
import { initDb, getAnalyzedArticles, getRelatedEvents, insertWebhookEvent, getArticleById, articleToClientEvent, type WebhookEventInput } from './db/sqlite'
import { startSummaryWorker } from './workers/summary'
import { initSocket } from './services/socket'
import { startScraper } from './services/scraper'
import { startOllamaWorker } from './services/ollama'
import { startRetention } from './workers/retention'
import { getLlmConfig, setLlmConfig } from './config/llmConfig'
import { getFeedsConfig, setFeedsConfig } from './config/feedsConfig'
import { getAzureSpeechConfig, setAzureSpeechConfig } from './config/azureSpeechConfig'
import { getHealthSnapshot, startOllamaHealthPoll } from './services/healthTracker'
import { checkRateLimit } from './services/rateLimiter'
import { resolveConflictSources, loadConflictFronts } from './services/conflictSources'
import { fetchQuotes, fetchHistories, isValidRange, MAX_SYMBOLS } from './services/market'
import {
  fetchMarkets, fetchSeries, isValidWindow, isProviderName, MAX_IDS, PROVIDER_NAMES,
} from './services/prediction'
import { watchedIds, categoryOf, countriesOf } from './config/predictionMarkets'
import { getPredictionConfig, setPredictionConfig } from './config/predictionConfig'
import {
  resolveEventLimit, validateExportParams, validateEventId, validateLlmConfigBody,
  validateFeedsBody, validateConfigAuth, validateAzureSpeechConfigBody, validateSpeechSynthesizeBody,
} from './utils/validation'
import { logger } from './utils/logger'
import type { EventCategory, EventIntensity } from './types'


const app        = express()
const httpServer = createServer(app)
const io         = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' },
})

const PORT = Number(process.env.PORT ?? 3001)

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }))
app.use(helmet({ contentSecurityPolicy: false }))   // CSP disabled: client uses WebGL/Canvas
// The event feed is a few hundred KB of highly repetitive JSON — the same
// category, intensity and reliability strings over and over. It compresses
// about 3x, which is a far better return than paginating it would be: the
// client needs every event anyway to compute its severity census, hourly
// histograms and per-country map fills, so splitting the response into pages
// would move the same bytes in more round trips.
app.use(compression())
app.use(express.json())

// ── REST routes ──────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json(getHealthSnapshot())
})

app.get('/api/events', (req, res) => {
  try {
    const limit = resolveEventLimit(req.query.limit as string | undefined)
    if (typeof limit === 'string') return res.status(400).json({ error: limit })
    res.json(getAnalyzedArticles(limit))
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Webhook event ingestion ──────────────────────────────

const VALID_CATEGORY_SET = new Set<EventCategory>([
  'ARMED_CONFLICT','POLITICAL','ECONOMIC','SOCIAL',
  'SCIENCE_TECH','ENVIRONMENT','HEALTH','CRIME_SECURITY','SPACE',
])
const VALID_INTENSITY_SET = new Set<EventIntensity>(['LOW','MODERATE','HIGH','CRITICAL'])

app.post('/api/events/webhook', (req, res) => {
  const webhookIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(`webhook:${webhookIp}`, 10, 60_000)) {
    res.status(429).json({ error: 'Rate limited — please wait 60 seconds' }); return
  }
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) { res.status(503).json({ error: 'Webhook endpoint not configured' }); return }
  if (req.headers['x-webhook-key'] !== secret) {
    res.status(401).json({ error: 'Invalid or missing X-Webhook-Key' }); return
  }

  const b = req.body as {
    title?: string; category?: string; intensity?: string
    location_label?: string; lat?: number; lng?: number
    actors?: string[]; tags?: string[]
    source?: string; url?: string; published_at?: string
  }

  if (!b.title || typeof b.title !== 'string') {
    res.status(400).json({ error: 'title required' }); return
  }
  if (!VALID_CATEGORY_SET.has(b.category as EventCategory)) {
    res.status(400).json({ error: `category must be one of: ${[...VALID_CATEGORY_SET].join(', ')}` }); return
  }
  if (!VALID_INTENSITY_SET.has(b.intensity as EventIntensity)) {
    res.status(400).json({ error: `intensity must be one of: ${[...VALID_INTENSITY_SET].join(', ')}` }); return
  }

  const id = `wh-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = new Date().toISOString()
  const event: WebhookEventInput = {
    id,
    title:          b.title.slice(0, 300),
    category:       b.category!,
    intensity:      b.intensity!,
    location_label: b.location_label ?? null,
    location_type:  b.lat != null ? 'geo' : null,
    lat:            b.lat ?? null,
    lng:            b.lng ?? null,
    actors:         Array.isArray(b.actors) ? b.actors.map(String).slice(0, 20) : [],
    tags:           Array.isArray(b.tags)   ? b.tags.map(String).slice(0, 20)   : [],
    source:         (b.source ?? 'Webhook').slice(0, 100),
    url:            (b.url ?? '').slice(0, 2000),
    published_at:   b.published_at ?? now,
    heat_score:     b.intensity === 'CRITICAL' ? 2.0 : b.intensity === 'HIGH' ? 1.5 : b.intensity === 'MODERATE' ? 1.0 : 0.5,
    expires_at:     new Date(Date.now() + 48 * 3600_000).toISOString(),
  }

  try {
    insertWebhookEvent(event)
    // Read the row back rather than rebuilding it here. The insert resolves
    // coordinates through the gazetteer, so a hand-assembled copy of `event`
    // would broadcast the caller's unresolved lat/lng while the database held
    // the resolved ones.
    const stored = getArticleById(id)
    if (!stored) {
      res.status(500).json({ error: 'Event was not stored' }); return
    }
    io.emit('new_event', articleToClientEvent(stored))
    res.json({ id, message: 'Event ingested' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/events/export', (req, res) => {
  const exportIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(`export:${exportIp}`, 5, 60_000)) {
    res.status(429).json({ error: 'Rate limited — please wait 60 seconds' }); return
  }
  try {
    const format  = req.query.format  as string | undefined
    const idsParam = req.query.ids    as string | undefined
    const err = validateExportParams(format, idsParam)
    if (err) { res.status(400).json({ error: err }); return }
    const allEvents = getAnalyzedArticles()
    const resolvedFormat = format ?? 'json'
    const events = idsParam
      ? (() => {
          const idSet = new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean))
          return allEvents.filter((e) => idSet.has(e.id))
        })()
      : allEvents
    if (resolvedFormat === 'csv') {
      const header = 'id,title,category,intensity,location,heat_score,published_at,source,url\n'
      const rows = events.map((e) => [
        e.id,
        `"${(e.title ?? '').replace(/"/g, '""')}"`,
        e.category,
        e.intensity,
        `"${(e.location_label ?? '').replace(/"/g, '""')}"`,
        e.heat_score ?? '',
        e.published_at ?? '',
        `"${(e.source ?? '').replace(/"/g, '""')}"`,
        `"${(e.url ?? '').replace(/"/g, '""')}"`,
      ].join(',')).join('\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="argus-events-${Date.now()}.csv"`)
      res.send(header + rows)
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="argus-events-${Date.now()}.json"`)
      res.json(events)
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/events/:id/related', (req, res) => {
  const err = validateEventId(req.params.id)
  if (err) { res.status(400).json({ error: err }); return }
  try {
    res.json(getRelatedEvents(req.params.id))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Optional auth guard for config mutation endpoints.
// If CONFIG_SECRET env var is set, callers must provide X-Config-Key header with matching value.
// If CONFIG_SECRET is not set, requests pass through (self-hosted default — no breaking change).
function checkConfigAuth(req: express.Request, res: express.Response): boolean {
  const err = validateConfigAuth(
    req.headers['x-config-key'] as string | undefined,
    process.env.CONFIG_SECRET,
  )
  if (err) { res.status(401).json({ error: err }); return false }
  return true
}

app.get('/api/config/llm', (_req, res) => {
  res.json(getLlmConfig())
})

app.post('/api/config/llm', (req, res) => {
  if (!checkConfigAuth(req, res)) return
  const err = validateLlmConfigBody(req.body)
  if (err) { res.status(400).json({ error: err }); return }
  try {
    const updated = setLlmConfig(req.body)
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.get('/api/ollama/models', async (_req, res) => {
  try {
    const client = new Ollama({ host: getLlmConfig().host })
    const result = await client.list()
    res.json(result.models.map((m) => m.name))
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
})

app.get('/api/config/feeds', (_req, res) => {
  res.json(getFeedsConfig())
})

app.post('/api/config/feeds', (req, res) => {
  if (!checkConfigAuth(req, res)) return
  const feedsErr = validateFeedsBody(req.body)
  if (feedsErr) { res.status(400).json({ error: feedsErr }); return }
  try {
    const updated = setFeedsConfig(req.body)
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

// The subscription key never goes to the client — only whether one is set —
// so a browser fetching this config can't leak it back out over the network.
app.get('/api/config/azure-speech', (_req, res) => {
  const cfg = getAzureSpeechConfig()
  res.json({ region: cfg.region, voice: cfg.voice, hasKey: Boolean(cfg.key) })
})

app.post('/api/config/azure-speech', (req, res) => {
  if (!checkConfigAuth(req, res)) return
  const err = validateAzureSpeechConfigBody(req.body)
  if (err) { res.status(400).json({ error: err }); return }
  const updated = setAzureSpeechConfig(req.body)
  res.json({ region: updated.region, voice: updated.voice, hasKey: Boolean(updated.key) })
})


// ── Agent chat endpoint ──────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are an intelligence analyst embedded in a real-time global surveillance system.
The user is viewing a geopolitical or astronomical event panel and asking follow-up questions.
You have access to current intelligence context provided below.
Respond in HTML format only. Use only these tags: <p> <ul> <ol> <li> <table> <thead> <tbody> <tr> <td> <th> <b> <i> <h4> <br>.
Keep responses concise and intelligence-focused. No markdown, no code blocks, no extra commentary.
If the question is in Chinese, respond in Traditional Chinese (繁體中文).`

app.post('/api/agent', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress
    ?? 'unknown'
  if (!checkRateLimit(`agent:${ip}`, 5, 30_000)) {
    res.status(429).json({ error: 'Rate limited — please wait 30 seconds' }); return
  }

  const { context, question } = req.body as { context?: string; question?: string }
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    res.status(400).json({ error: 'question required' }); return
  }
  const cfg    = getLlmConfig()
  const client = new Ollama({ host: cfg.host })
  const userMsg = `Intelligence Context:\n${(context ?? '').slice(0, 2000)}\n\nAnalyst Question: ${question.trim()}`

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const stream = await client.chat({
      model: cfg.model,
      messages: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      options: { temperature: 0.7, num_ctx: cfg.contextSize },
      stream: true,
    })
    for await (const chunk of stream) {
      const text = chunk.message?.content
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
  }
  res.end()
})

// ── Vision analysis endpoint ─────────────────────────────
// Accepts a base64-encoded JPEG/PNG screenshot from the client canvas,
// passes it to a multimodal Ollama model for geopolitical analysis.

const VISION_SYSTEM_PROMPT = `You are an intelligence analyst examining a real-time geopolitical globe visualization.
The user has captured a screenshot of the globe and wants a strategic analysis.
Describe what you observe: active conflict zones, orbital events, anomalies, geographic patterns.
Then provide a brief intelligence assessment.
Respond in HTML format only. Use only these tags: <p> <ul> <ol> <li> <b> <i> <h4> <br>.
If the question is in Chinese, respond in Traditional Chinese (繁體中文).`

app.post('/api/agent-vision', async (req, res) => {
  const visionIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(`vision:${visionIp}`, 5, 30_000)) {
    res.status(429).json({ error: 'Rate limited — please wait 30 seconds' }); return
  }
  try {
    const { image, question, context } = req.body as {
      image?: string
      question?: string
      context?: string
    }
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'image (base64) required' }); return
    }
    const cfg    = getLlmConfig()
    const client = new Ollama({ host: cfg.host })
    const userMsg = question?.trim()
      ? `${question.trim()}${context ? `\n\nContext:\n${context.slice(0, 800)}` : ''}`
      : `Analyze this globe screenshot and provide an intelligence assessment.${context ? `\n\nContext:\n${context.slice(0, 800)}` : ''}`

    const response = await client.chat({
      model: cfg.model,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        { role: 'user', content: userMsg, images: [image] },
      ],
      options: { temperature: 0.6, num_ctx: cfg.contextSize },
    })
    res.json({ html: response.message.content })
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
})

// ── Speech synthesis (Azure) ──────────────────────────────
// Proxies Azure's TTS REST API so the subscription key is only ever held
// server-side. Used to read the intel brief aloud when configured.

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string
  ))
}

app.post('/api/speech/synthesize', async (req, res) => {
  const speechIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(`speech:${speechIp}`, 10, 60_000)) {
    res.status(429).json({ error: 'Rate limited — please wait a moment' }); return
  }
  const err = validateSpeechSynthesizeBody(req.body)
  if (err) { res.status(400).json({ error: err }); return }

  const cfg = getAzureSpeechConfig()
  if (!cfg.key || !cfg.region) {
    res.status(400).json({ error: 'Azure Speech is not configured' }); return
  }

  const { text } = req.body as { text: string }
  // "zh-TW-HsiaoChenNeural" → "zh-TW", the xml:lang SSML expects.
  const lang = cfg.voice.split('-').slice(0, 2).join('-')
  const ssml = `<speak version="1.0" xml:lang="${escapeXml(lang)}"><voice name="${escapeXml(cfg.voice)}">${escapeXml(text.trim().slice(0, 4000))}</voice></speak>`

  try {
    const azureRes = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cfg.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml,
    })
    if (!azureRes.ok) {
      logger.warn('[Speech]', `Azure TTS request failed: ${azureRes.status}`)
      res.status(502).json({ error: `Azure Speech error: ${azureRes.status}` }); return
    }
    res.setHeader('Content-Type', 'audio/mpeg')
    res.send(Buffer.from(await azureRes.arrayBuffer()))
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
})

// ── Tracking layer proxy routes ──────────────────────────
// In-memory cache: avoids hammering upstream APIs on every client refresh
const _trackingCache = new Map<string, { data: unknown; ts: number }>()
const TRACKING_TTL   = { aircraft: 45_000, tle: 600_000, ships: 60_000 } // ms

interface ShipState {
  mmsi:    string
  name:    string | null
  lat:     number
  lng:     number
  heading: number | null
  speed:   number | null
}

async function fetchAisSnapshot(apiKey: string): Promise<ShipState[]> {
  return new Promise((resolve, reject) => {
    const ships = new Map<string, ShipState>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = new (globalThis as any).WebSocket('wss://stream.aisstream.io/v0/stream')
    const timer = setTimeout(() => {
      try { ws.close() } catch { /* ignore */ }
      resolve([...ships.values()].slice(0, 500))
    }, 5_000)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }))
    }
    ws.onmessage = (event: { data: string }) => {
      try {
        const data = JSON.parse(event.data) as {
          MessageType?: string
          Message?: { PositionReport?: { Latitude: number; Longitude: number; TrueHeading?: number; Sog?: number } }
          MetaData?: { MMSI?: number; ShipName?: string }
        }
        if (data.MessageType === 'PositionReport' && data.Message?.PositionReport && data.MetaData) {
          const pos  = data.Message.PositionReport
          const meta = data.MetaData
          const mmsi = String(meta.MMSI ?? '')
          if (!mmsi || pos.Latitude == null || pos.Longitude == null) return
          ships.set(mmsi, {
            mmsi,
            name:    meta.ShipName?.trim() || null,
            lat:     pos.Latitude,
            lng:     pos.Longitude,
            heading: (pos.TrueHeading != null && pos.TrueHeading !== 511) ? pos.TrueHeading : null,
            speed:   pos.Sog ?? null,
          })
        }
      } catch { /* ignore parse errors */ }
    }
    ws.onerror = (err: unknown) => { clearTimeout(timer); reject(err) }
    ws.onclose = () => clearTimeout(timer)
  })
}

async function fetchCached<T>(
  key: string, ttl: number, fetcher: () => Promise<T>,
): Promise<T> {
  const hit = _trackingCache.get(key)
  if (hit && Date.now() - hit.ts < ttl) return hit.data as T
  const data = await fetcher()
  _trackingCache.set(key, { data, ts: Date.now() })
  return data
}

// Aircraft positions (OpenSky Network — free, no auth required)
app.get('/api/tracking/aircraft', async (_req, res) => {
  try {
    const aircraft = await fetchCached('aircraft', TRACKING_TTL.aircraft, async () => {
      const r = await fetch('https://opensky-network.org/api/states/all', {
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw new Error(`OpenSky ${r.status}`)
      const body = await r.json() as { states: unknown[][] | null }
      return (body.states ?? [])
        .filter((s) => s[6] != null && s[5] != null && s[8] === false) // has coords, airborne
        .map((s) => ({
          icao:     s[0],
          callsign: (s[1] as string | null)?.trim() || null,
          lat:      s[6] as number,
          lng:      s[5] as number,
          altitude: s[7] as number | null,   // baro altitude (m)
          velocity: s[9] as number | null,   // m/s
          heading:  s[10] as number | null,  // degrees
          country:  s[2] as string,
        }))
        .slice(0, 800)
    })
    res.json(aircraft)
  } catch (err) {
    logger.warn('[tracking]', 'aircraft fetch failed:', (err as Error).message)
    res.json([])
  }
})

// Satellite TLE data (Celestrak — free, no auth)
// group param: 'stations' | 'visual' | 'starlink' | 'active' (default: stations+visual)
app.get('/api/tracking/tle', async (req, res) => {
  const groups = ((req.query.groups as string) || 'stations,visual').split(',').slice(0, 4)
  const cacheKey = `tle-${groups.join('_')}`
  try {
    const sats = await fetchCached(cacheKey, TRACKING_TTL.tle, async () => {
      const results: { name: string; tle1: string; tle2: string }[] = []
      for (const group of groups) {
        const r = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group.trim()}&FORMAT=tle`,
          { signal: AbortSignal.timeout(10_000) },
        )
        if (!r.ok) continue
        const text = await r.text()
        const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
        for (let i = 0; i + 2 < lines.length; i += 3) {
          if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 '))
            results.push({ name: lines[i], tle1: lines[i + 1], tle2: lines[i + 2] })
        }
      }
      return results
    })
    res.json(sats)
  } catch (err) {
    logger.warn('[tracking]', 'TLE fetch failed:', (err as Error).message)
    res.json([])
  }
})

// Ship positions (aisstream.io — requires AISSTREAM_API_KEY env var; returns [] if not set)
app.get('/api/tracking/ships', async (_req, res) => {
  const apiKey = process.env.AISSTREAM_API_KEY
  if (!apiKey) {
    res.json([])
    return
  }
  try {
    const ships = await fetchCached<ShipState[]>('ships', TRACKING_TTL.ships, () => fetchAisSnapshot(apiKey))
    res.json(ships)
  } catch (err) {
    logger.warn('[tracking]', 'ships fetch failed:', (err as Error).message)
    res.json([])
  }
})

// ── Market Quotes ─────────────────────────────────────────
// Closing price and daily change for symbols the client resolved from
// Wikidata. Symbols not recognised upstream are omitted from the reply rather
// than reported: on the panel, an unresolvable listing and an entity with no
// listing are the same thing — nothing shown.

app.get('/api/market/quote', async (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS)

  if (symbols.length === 0) {
    res.json([])
    return
  }

  try {
    res.json(await fetchQuotes(symbols))
  } catch (err) {
    logger.warn('[market]', 'quote fetch failed:', (err as Error).message)
    res.json([])
  }
})

// ── Market History ────────────────────────────────────────
// Daily closes, for the questions a spot price cannot answer: what a market
// has done *since* an event, and whether a disruption held over weeks. Serves
// the series rather than a computed change — the caller knows which instant it
// is measuring from, and this does not.

app.get('/api/market/history', async (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS)

  const rangeParam = String(req.query.range ?? '1mo')
  if (symbols.length === 0 || !isValidRange(rangeParam)) {
    res.json([])
    return
  }

  try {
    res.json(await fetchHistories(symbols, rangeParam))
  } catch (err) {
    logger.warn('[market]', 'history fetch failed:', (err as Error).message)
    res.json([])
  }
})

// ── Prediction Markets ────────────────────────────────────
// What is priced to happen, for the events that have no ticker. Called with no
// parameters this serves the watchlist of whichever source is configured, which
// is the panel's normal request; `?ids=` exists for the region and event views
// that will ask for a subset later. Same absence contract as the quote routes —
// a market that has resolved is simply missing from the reply.

app.get('/api/prediction/markets', async (req, res) => {
  const predIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(`prediction:${predIp}`, 30, 60_000)) {
    res.status(429).json({ error: 'Rate limited — please wait 60 seconds' }); return
  }

  const { provider } = getPredictionConfig()
  const asked = String(req.query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ids = (asked.length > 0 ? asked : watchedIds(provider)).slice(0, MAX_IDS)

  try {
    const markets = await fetchMarkets(ids, provider)

    // The watchlist is maintained by hand and goes stale on its own: markets
    // resolve, and a resolved id drops out of the reply silently because on the
    // panel it is indistinguishable from one that never existed. That is right
    // for the reader and useless for whoever maintains the list, so the gap is
    // logged here rather than shown there.
    if (asked.length === 0 && markets.length < ids.length) {
      const missing = ids.filter((id) => !markets.some((m) => m.id === id))
      logger.info('[prediction]', `${provider}: ${missing.length} watchlist id(s) returned nothing:`, missing.join(', '))
    }

    // Category and countries travel with the row so the two panels can group
    // and filter these without being handed the watchlist table as well.
    res.json(markets.map((m) => ({
      ...m,
      category:  categoryOf(provider, m.id),
      countries: countriesOf(provider, m.id),
    })))
  } catch (err) {
    logger.warn('[prediction]', 'market fetch failed:', (err as Error).message)
    res.json([])
  }
})

// ── Prediction History ────────────────────────────────────
// Prices over time, for the timeline. Takes ids rather than the routing keys
// each source really uses — a CLOB token on one, a series ticker on the other —
// because that is an implementation detail of the source, and resolving it here
// costs a cache hit on markets the caller has almost certainly just fetched.
//
// Several at once, because that is how the scrub needs them. Rewinding moves
// the whole interface to an instant, so every row has to move together — one
// row priced an hour ago beside eight priced now is the contradiction scene
// time exists to prevent.

app.get('/api/prediction/history', async (req, res) => {
  const histIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
    ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(`prediction-history:${histIp}`, 20, 60_000)) {
    res.status(429).json({ error: 'Rate limited — please wait 60 seconds' }); return
  }

  const { provider } = getPredictionConfig()
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS)
  const windowParam = String(req.query.window ?? '1d')
  if (ids.length === 0 || !isValidWindow(windowParam)) {
    res.json([])
    return
  }

  try {
    // A market that cannot be charted, or that resolved since the panel opened,
    // drops out here — which is the same thing the caller does with either:
    // draw no line for that row.
    const markets = await fetchMarkets(ids, provider)
    res.json(await fetchSeries(markets.filter((m) => m.historyKey !== null), windowParam))
  } catch (err) {
    logger.warn('[prediction]', 'history fetch failed:', (err as Error).message)
    res.json([])
  }
})

// ── Prediction Provider ───────────────────────────────────
// Which source the panel reads. A setting rather than a constant because the
// answer is regional — see config/predictionConfig.ts.

app.get('/api/config/prediction', (_req, res) => {
  res.json({ ...getPredictionConfig(), available: PROVIDER_NAMES })
})

app.post('/api/config/prediction', (req, res) => {
  if (!checkConfigAuth(req, res)) return
  const body = req.body as { provider?: unknown }
  if (!isProviderName(body.provider)) {
    res.status(400).json({ error: `provider must be one of: ${PROVIDER_NAMES.join(', ')}` })
    return
  }
  res.json(setPredictionConfig({ provider: body.provider }))
})

// ── Conflict Front Layer ──────────────────────────────────
// Serves a merged GeoJSON FeatureCollection of active conflict fronts.
// Sources come from CONFLICT_SOURCES (preset name or JSON array) or the legacy
// single CONFLICT_GEOJSON_URL; see services/conflictSources.ts. With neither
// set — or if every source comes back empty — returns embedded demo data
// (approximate Ukraine 2024 contact line).

let _demConflictGeoJSON: unknown | null = null
function getDemoConflictGeoJSON(): unknown {
  if (_demConflictGeoJSON) return _demConflictGeoJSON
  try {
    const p = join(__dirname, '../../client/public/geodata/conflict_fronts_demo.geojson')
    _demConflictGeoJSON = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    _demConflictGeoJSON = { type: 'FeatureCollection', features: [] }
  }
  return _demConflictGeoJSON
}

const CONFLICT_TTL = 24 * 60 * 60 * 1000  // 24 hours

app.get('/api/conflict/fronts', async (_req, res) => {
  const sources = resolveConflictSources()
  if (sources.length === 0) {
    res.json(getDemoConflictGeoJSON())
    return
  }
  try {
    const merged = await loadConflictFronts(sources, { ttlMs: CONFLICT_TTL })
    res.json(merged ?? getDemoConflictGeoJSON())
  } catch (err) {
    logger.warn('[conflict]', 'source load failed, using demo data:', (err as Error).message)
    res.json(getDemoConflictGeoJSON())
  }
})

// ── Static files (production) ─────────────────────────────
// In production the Express server doubles as a static file host for the
// pre-built React client.  API and Socket.io routes are registered first so
// they take precedence; the catch-all only fires for unknown paths.

if (process.env.NODE_ENV === 'production') {
  const clientDist = join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.sendFile(join(clientDist, 'index.html'))
  })
}

// ── Last-resort process guards ───────────────────────────
// Most of the work here happens on timers nobody is awaiting — the scraper
// cron, the Ollama poll, the summary brief. Without these handlers a single
// rejected promise inside one of them takes the whole process down under
// Node's default `--unhandled-rejections=throw`, and the API port goes with
// it. The dev client keeps running when that happens, so the only symptom the
// reader sees is every request turning into a Vite proxy ECONNREFUSED, with
// the actual cause somewhere far up the terminal scrollback.
//
// A background job that failed is not a reason to stop serving events that are
// already in the database, so a rejection is logged and the process carries
// on. An uncaught exception is different: it unwound a real stack and left
// state unknown, so that one still exits — but loudly, and with the stack.

process.on('unhandledRejection', (reason) => {
  logger.error('[ARGUS]', 'Unhandled promise rejection (server kept running):',
    reason instanceof Error ? reason.stack ?? reason.message : reason)
})

process.on('uncaughtException', (err) => {
  logger.error('[ARGUS]', 'Uncaught exception — exiting:', err.stack ?? err.message)
  process.exit(1)
})

// ── Bootstrap ────────────────────────────────────────────

async function main() {
  initDb()
  initSocket(io)
  startScraper()
  startOllamaWorker(io)
  startRetention()
  startSummaryWorker(io)
  startOllamaHealthPoll()

  httpServer.listen(PORT, () => {
    logger.info('[ARGUS]', `Server → http://localhost:${PORT}`)
  })
}

main().catch((err) => {
  logger.error('[ARGUS]', 'Fatal startup error:', err)
  process.exit(1)
})
