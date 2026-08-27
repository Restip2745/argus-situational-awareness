import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../store'
import { useDraggable } from '../../hooks/useDraggable'
import { useFilteredEvents } from '../../hooks/useFilteredEvents'
import { useServiceHealth } from '../../hooks/useServiceHealth'
import { copyToClipboard } from '../../utils/clipboard'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { preview } from '../../lib/sound'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface LlmConfig {
  host:        string
  model:       string
  temperature: number
  contextSize: number
}

interface FeedConfigItem {
  name:    string
  url:     string
  lang:    'en' | 'zh' | 'ar' | 'fr'
  region:  string | null
  enabled: boolean
}

interface AzureSpeechConfig {
  region: string
  voice:  string
  hasKey: boolean
}

// A curated set rather than a free-text field — most Azure neural voices are
// irrelevant here, and a dropdown means no one has to know Azure's naming
// scheme to pick between "read this in Mandarin" and "read this in English".
// Labels live in the locale files (config.azureVoice.<id>), not here.
const AZURE_VOICE_IDS = [
  'zh-TW-HsiaoChenNeural',
  'zh-TW-YunJheNeural',
  'zh-TW-HsiaoYuNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-GB-SoniaNeural',
] as const

interface FeedStatus {
  name:         string
  lastSuccess:  string | null
  lastError:    string | null
  errorMessage: string | null
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionTitle({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="h-px flex-1 bg-[rgba(0,180,255,0.12)]" />
      <span className="text-[#9b6dff] tracking-[0.12em] text-[11px] uppercase">{label}</span>
      <div className="h-px flex-1 bg-[rgba(0,180,255,0.12)]" />
    </div>
  )
}

// ── Input row label ───────────────────────────────────────────────────────────
function FieldLabel({ text, value }: { text: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between mb-1">
      <span className="text-[#4a6070] text-[10px] tracking-widest">{text}</span>
      {value !== undefined && <span className="text-[#00d4ff] text-[10px]">{value}</span>}
    </div>
  )
}

// ── Toggle row ────────────────────────────────────────────────────────────────
function ToggleRow({ label, hint, checked, onChange, accent = '#00d4ff' }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  accent?: string
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-full flex items-start gap-2.5 text-left py-1.5"
      style={{ cursor: 'pointer', background: 'none', border: 'none' }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0, marginTop: '1px',
          width: '26px', height: '15px', borderRadius: '8px',
          background: checked ? accent + '30' : 'rgba(0,180,255,0.06)',
          border: `1px solid ${checked ? accent + '80' : 'rgba(0,180,255,0.18)'}`,
          position: 'relative', transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: '2px', left: checked ? '13px' : '2px',
          width: '9px', height: '9px', borderRadius: '50%',
          background: checked ? accent : '#3a5060',
          boxShadow: checked ? `0 0 6px ${accent}` : 'none',
          transition: 'left 0.15s, background 0.15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="block text-[11px]" style={{ color: checked ? '#c8dde8' : '#5d7c92' }}>{label}</span>
        {hint && <span className="block text-[10px] mt-0.5 leading-snug" style={{ color: '#2a4a63' }}>{hint}</span>}
      </span>
    </button>
  )
}

export function ConfigModal() {
  const { t } = useTranslation()
  const filteredEvents = useFilteredEvents()
  const allEvents      = useAppStore((s) => s.events)
  const setShowConfig  = useAppStore((s) => s.setShowConfig)
  const [curlCopied, setCurlCopied] = useState(false)
  const uiScale       = useAppStore((s) => s.uiScale)
  const homeView        = useAppStore((s) => s.homeView)
  const setHomeView     = useAppStore((s) => s.setHomeView)
  const nebulaIntensity    = useAppStore((s) => s.nebulaIntensity)
  const setNebulaIntensity = useAppStore((s) => s.setNebulaIntensity)
  const upColor         = useAppStore((s) => s.upColor)
  const setUpColor      = useAppStore((s) => s.setUpColor)
  const decorativeFx    = useAppStore((s) => s.decorativeFx)
  const setDecorativeFx = useAppStore((s) => s.setDecorativeFx)
  const soundEnabled    = useAppStore((s) => s.soundEnabled)
  const setSoundEnabled = useAppStore((s) => s.setSoundEnabled)
  const soundVolume     = useAppStore((s) => s.soundVolume)
  const setSoundVolume  = useAppStore((s) => s.setSoundVolume)
  const setUiScale    = useAppStore((s) => s.setUiScale)
  const bumpPredictionEpoch = useAppStore((s) => s.bumpPredictionEpoch)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef, true)

  const [config,   setConfig]   = useState<LlmConfig | null>(null)
  const [models,   setModels]   = useState<string[]>([])
  const [status,   setStatus]   = useState<'idle' | 'loading' | 'saving' | 'error'>('loading')
  const [errMsg,   setErrMsg]   = useState('')
  const [dirty,    setDirty]    = useState(false)
  const [hovered,  setHovered]  = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragOffsetRef = useRef(dragOffset)
  dragOffsetRef.current = dragOffset
  const { onMouseDown: startDrag, dragging } = useDraggable()

  const [feeds,       setFeeds]       = useState<FeedConfigItem[]>([])
  const [feedStatuses, setFeedStatuses] = useState<Record<string, FeedStatus>>({})
  const [newFeedName, setNewFeedName] = useState('')
  const [newFeedUrl,  setNewFeedUrl]  = useState('')
  const [localScale,  setLocalScale]  = useState(uiScale)

  // Which exchange the prediction panel reads. A server setting rather than a
  // store one: the watchlist, the id space and the volume floor all belong to
  // whichever source is chosen, so the choice has to be made where they are.
  const [predictionProvider, setPredictionProvider] = useState<string | null>(null)
  const [providersAvailable, setProvidersAvailable] = useState<string[]>([])

  const [azureSpeech,   setAzureSpeech]   = useState<AzureSpeechConfig | null>(null)
  // A fresh key the user just typed; empty means "leave whatever is saved
  // alone" — the server never echoes the key back, so there is nothing to
  // prefill this with.
  const [azureKeyInput, setAzureKeyInput] = useState('')

  // Snapshot of last-saved state — used by Cancel to revert
  const savedConfig      = useRef<LlmConfig | null>(null)
  const savedFeeds       = useRef<FeedConfigItem[]>([])
  const savedScale       = useRef(uiScale)
  const savedAzureSpeech = useRef<AzureSpeechConfig | null>(null)
  const savedPredictionProvider = useRef<string | null>(null)

  // ── Drag ──────────────────────────────────────────────────
  function handleHeaderMouseDown(e: React.MouseEvent) {
    const rect = cardRef.current?.getBoundingClientRect()
    const W = window.innerWidth, H = window.innerHeight
    const { x: initX, y: initY } = dragOffsetRef.current
    const startX = e.clientX, startY = e.clientY
    const minX = rect ? initX - rect.left        : -Infinity
    const maxX = rect ? initX + (W - rect.right)  :  Infinity
    const minY = rect ? initY - rect.top          : -Infinity
    const maxY = rect ? initY + (H - rect.bottom) :  Infinity
    startDrag(e, (mv) => {
      setDragOffset({
        x: Math.max(minX, Math.min(maxX, initX + mv.clientX - startX)),
        y: Math.max(minY, Math.min(maxY, initY + mv.clientY - startY)),
      })
    })
  }

  // ── Fetch ─────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setStatus('loading')
    setErrMsg('')
    try {
      const [cfgRes, modRes, feedsRes, healthRes, azureRes, predRes] = await Promise.all([
        fetch(`${API}/api/config/llm`),
        fetch(`${API}/api/ollama/models`),
        fetch(`${API}/api/config/feeds`),
        fetch(`${API}/api/health`),
        fetch(`${API}/api/config/azure-speech`),
        fetch(`${API}/api/config/prediction`),
      ])
      if (!cfgRes.ok) throw new Error(`Config fetch failed: ${cfgRes.status}`)
      const cfg: LlmConfig = await cfgRes.json()
      const fds: FeedConfigItem[] = feedsRes.ok ? await feedsRes.json() : []
      const azure: AzureSpeechConfig = azureRes.ok
        ? await azureRes.json()
        : { region: '', voice: 'zh-TW-HsiaoChenNeural', hasKey: false }
      if (healthRes.ok) {
        const h = await healthRes.json() as { feedStatuses?: FeedStatus[] }
        const statusMap: Record<string, FeedStatus> = {}
        for (const s of (h.feedStatuses ?? [])) statusMap[s.name] = s
        setFeedStatuses(statusMap)
      }
      setConfig(cfg);       savedConfig.current = cfg
      setFeeds(fds);        savedFeeds.current  = fds
      setLocalScale(uiScale); savedScale.current = uiScale
      setAzureSpeech(azure); savedAzureSpeech.current = azure
      setAzureKeyInput('')
      // The list of sources comes from the server rather than being restated
      // here: a build that knows about a provider this server does not have
      // would offer a choice that cannot be saved.
      if (predRes.ok) {
        const pred = await predRes.json() as { provider: string; available: string[] }
        setPredictionProvider(pred.provider)
        savedPredictionProvider.current = pred.provider
        setProvidersAvailable(pred.available ?? [])
      }
      setModels(modRes.ok ? await modRes.json() : [])
      setDirty(false)
      setStatus('idle')
    } catch (err) {
      setErrMsg((err as Error).message)
      setStatus('error')
    }
  }, [uiScale])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // ── Apply (save + close) ──────────────────────────────────
  async function handleApply() {
    if (!config) return
    setStatus('saving')
    setErrMsg('')
    try {
      const [llmRes, feedsRes, azureRes] = await Promise.all([
        fetch(`${API}/api/config/llm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        }),
        fetch(`${API}/api/config/feeds`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feeds),
        }),
        fetch(`${API}/api/config/azure-speech`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            region: azureSpeech?.region ?? '',
            voice:  azureSpeech?.voice  ?? 'zh-TW-HsiaoChenNeural',
            // Omit key entirely unless the user typed a new one — sending ''
            // would overwrite an already-saved key with nothing.
            ...(azureKeyInput.trim() ? { key: azureKeyInput.trim() } : {}),
          }),
        }),
      ])
      // Sent only when it changed. The other saves here are idempotent
      // rewrites of what is already on screen; this one clears a cache of live
      // prices on the server, and doing that because someone opened settings to
      // adjust the volume would be a cost with nothing behind it.
      if (predictionProvider !== null && predictionProvider !== savedPredictionProvider.current) {
        await fetch(`${API}/api/config/prediction`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: predictionProvider }),
        })
        savedPredictionProvider.current = predictionProvider
        bumpPredictionEpoch()
      }
      if (!llmRes.ok) throw new Error(`Save failed: ${llmRes.status}`)
      const saved: LlmConfig = await llmRes.json()
      const savedFds: FeedConfigItem[] = feedsRes.ok ? await feedsRes.json() : feeds
      const savedAzure: AzureSpeechConfig = azureRes.ok
        ? await azureRes.json()
        : (azureSpeech ?? { region: '', voice: 'zh-TW-HsiaoChenNeural', hasKey: false })
      savedConfig.current = saved
      savedFeeds.current  = savedFds
      savedScale.current  = localScale
      savedAzureSpeech.current = savedAzure
      setUiScale(localScale)
      setConfig(saved)
      setFeeds(savedFds)
      setAzureSpeech(savedAzure)
      setAzureKeyInput('')
      setDirty(false)
      setStatus('idle')
      setShowConfig(false)   // close after successful save
    } catch (err) {
      setErrMsg((err as Error).message)
      setStatus('error')
    }
  }

  // ── Cancel (revert + close) ────────────────────────────────
  function handleCancel() {
    if (savedConfig.current) setConfig(savedConfig.current)
    setFeeds(savedFeeds.current)
    setLocalScale(savedScale.current)
    setUiScale(savedScale.current)
    setAzureSpeech(savedAzureSpeech.current)
    setPredictionProvider(savedPredictionProvider.current)
    setAzureKeyInput('')
    setDirty(false)
    setShowConfig(false)
  }

  function patch(field: keyof LlmConfig, value: string | number) {
    setConfig((prev) => prev ? { ...prev, [field]: value } : prev)
    setDirty(true)
  }

  function patchAzure(field: 'region' | 'voice', value: string) {
    setAzureSpeech((prev) => prev ? { ...prev, [field]: value } : prev)
    setDirty(true)
  }

  function toggleFeed(i: number) {
    setFeeds((p) => p.map((f, idx) => idx === i ? { ...f, enabled: !f.enabled } : f))
    setDirty(true)
  }
  function deleteFeed(i: number) {
    setFeeds((p) => p.filter((_, idx) => idx !== i))
    setDirty(true)
  }
  function addFeed() {
    const name = newFeedName.trim(), url = newFeedUrl.trim()
    if (!name || !url) return
    setFeeds((p) => [...p, { name, url, lang: 'en', region: null, enabled: true }])
    setNewFeedName(''); setNewFeedUrl('')
    setDirty(true)
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !dragging) handleCancel()
  }

  const isLoading = status === 'loading' || status === 'saving'
  const serviceHealth = useServiceHealth()

  const filteredIds = useMemo(
    () => filteredEvents.map((e) => e.id).join(','),
    [filteredEvents],
  )
  const hasActiveFilter = filteredEvents.length < allEvents.length

  const cardStyle: React.CSSProperties = {
    transform:  `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
    transition: dragging ? 'none' : 'box-shadow 0.2s',
    boxShadow:  hovered
      ? '0 0 0 1px rgba(0,212,255,0.22), 0 12px 48px rgba(0,0,0,0.8), 0 0 32px rgba(0,180,255,0.1)'
      : '0 0 0 1px rgba(0,180,255,0.12), 0 8px 40px rgba(0,0,0,0.7)',
    cursor: dragging ? 'grabbing' : 'default',
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t('config.title')}
      style={{ zIndex: 200 }}
    >
      <div
        ref={cardRef}
        style={{ ...cardStyle, backgroundColor: '#04090e' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative w-[760px] max-w-[96vw] max-h-[90vh] overflow-hidden border border-[rgba(0,180,255,0.18)] rounded font-mono text-[11px] mx-4"
      >
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-[rgba(0,212,255,0.5)] rounded-tl pointer-events-none z-10" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-[rgba(0,212,255,0.5)] rounded-tr pointer-events-none z-10" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-[rgba(0,212,255,0.5)] rounded-bl pointer-events-none z-10" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-[rgba(0,212,255,0.5)] rounded-br pointer-events-none z-10" />

        {/* Scrollable wrapper */}
        <div className="max-h-[90vh] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.15) transparent' }}>

          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-3.5 border-b border-[rgba(0,180,255,0.12)] select-none sticky top-0 z-20"
            style={{ background: '#04090e', cursor: dragging ? 'grabbing' : 'grab' }}
            onMouseDown={handleHeaderMouseDown}
          >
            <span className="text-[#00d4ff] tracking-[0.15em] text-[10px] uppercase font-semibold">{t('config.title')}</span>
            <button
              onClick={handleCancel}
              className="text-[#4a6070] hover:text-[#00d4ff] transition-colors text-base leading-none"
              aria-label={t('config.actions.close')}
            >✕</button>
          </div>

          {/* ── Two-column body ── */}
          <div className="grid grid-cols-2 gap-x-6 px-6 py-5" style={{ alignItems: 'start' }}>

            {/* ── LEFT: LLM Settings + RSS Feeds + Webhook — the model and
                content-source integrations. Azure Speech is paired with
                Display on the right instead of here, purely so the two
                columns come out close to even. ── */}
            <div className="space-y-6">

              {/* LLM Settings */}
              <div className="space-y-4">
                <SectionTitle label={t('config.sections.llm')} />

                {status === 'loading' && !config ? (
                  <div className="text-[#2a4060] py-4 text-center tracking-widest">{t('config.status.loading')}</div>
                ) : status === 'error' && !config ? (
                  <div className="text-[#ff4d4d] py-2">{errMsg}</div>
                ) : config ? (<>

                  <label className="block">
                    <FieldLabel text={t('config.fields.ollamaHost')} />
                    <input
                      type="text" value={config.host}
                      onChange={(e) => patch('host', e.target.value)}
                      className="argus-input w-full border rounded px-2 py-1.5 transition-colors"
                      placeholder="http://localhost:11434"
                      disabled={isLoading}
                    />
                  </label>

                  <label className="block">
                    <div className="flex justify-between mb-1">
                      <FieldLabel text={t('config.fields.model')} />
                      <button
                        onClick={fetchAll} disabled={isLoading}
                        className="text-[#4a6070] hover:text-[#00d4ff] transition-colors text-[11px]"
                      >{t('config.model.refresh')}</button>
                    </div>
                    {models.length > 0 ? (
                      <select
                        value={config.model}
                        onChange={(e) => patch('model', e.target.value)}
                        className="argus-input w-full border rounded px-2 py-1.5 transition-colors appearance-none cursor-pointer"
                        disabled={isLoading}
                      >
                        {models.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text" value={config.model}
                        onChange={(e) => patch('model', e.target.value)}
                        className="argus-input w-full border rounded px-2 py-1.5 transition-colors"
                        placeholder="gemma4:e4b" disabled={isLoading}
                      />
                    )}
                    <span className="text-[#2a4060] text-[11px] mt-1 block">
                      {models.length > 0
                        ? t('config.model.available', { count: models.length })
                        : t('config.model.enterManually')}
                    </span>
                  </label>

                  <label className="block">
                    <FieldLabel text={t('config.fields.temperature')} value={config.temperature.toFixed(2)} />
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={config.temperature}
                      onChange={(e) => patch('temperature', parseFloat(e.target.value))}
                      className="w-full cursor-pointer" disabled={isLoading}
                    />
                    <div className="flex justify-between text-[#2a4060] text-[11px] mt-0.5">
                      <span>{t('config.temp.precise')}</span><span>{t('config.temp.creative')}</span>
                    </div>
                  </label>

                  <label className="block">
                    <FieldLabel text={t('config.fields.contextSize')} value={config.contextSize.toLocaleString()} />
                    <input
                      type="range" min={512} max={32768} step={512}
                      value={config.contextSize}
                      onChange={(e) => patch('contextSize', parseInt(e.target.value, 10))}
                      className="w-full cursor-pointer"
                      style={{ '--thumb-color': '#9b6dff', '--thumb-glow': 'rgba(155,109,255,0.6)' } as React.CSSProperties}
                      disabled={isLoading}
                    />
                    <div className="flex justify-between text-[#2a4060] text-[11px] mt-0.5">
                      <span>512</span><span>32 768</span>
                    </div>
                  </label>

                </>) : null}
              </div>

              {/* RSS Feeds */}
              <div>
                <SectionTitle label={t('config.sections.feeds')} />

                <div
                  className="space-y-0.5 mb-3 overflow-y-auto"
                  style={{ maxHeight: 200, scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,180,255,0.12) transparent' }}
                >
                  {feeds.length === 0 && (
                    <div className="text-[#2a4060] py-2 text-center">{t('config.feed.noFeeds')}</div>
                  )}
                  {feeds.map((feed, i) => {
                    const fs = feedStatuses[feed.name]
                    const dotColor = !fs ? '#2a4060'
                      : fs.lastError && (!fs.lastSuccess || fs.lastError > fs.lastSuccess) ? '#ff4d4d'
                      : '#39ff8a'
                    const dotTitle = !fs ? t('config.feed.noData')
                      : fs.errorMessage ? t('config.feed.error', { msg: fs.errorMessage })
                      : fs.lastSuccess ? t('config.feed.lastOk', { time: new Date(fs.lastSuccess).toLocaleTimeString() }) : ''
                    return (
                      <div key={i} className="flex items-center gap-2 py-1 border-b border-[rgba(0,180,255,0.06)]">
                        <button
                          onClick={() => toggleFeed(i)} disabled={isLoading}
                          className={`w-4 h-4 flex-shrink-0 border rounded-sm transition-colors text-[11px] flex items-center justify-center
                            ${feed.enabled
                              ? 'border-[rgba(0,212,255,0.6)] bg-[rgba(0,212,255,0.15)] text-[#00d4ff]'
                              : 'border-[rgba(0,180,255,0.2)] text-[#2a4060]'}`}
                          title={feed.enabled ? t('config.feed.disable') : t('config.feed.enable')}
                        >
                          {feed.enabled ? '✓' : ''}
                        </button>
                        {/* Feed health status dot */}
                        <span
                          title={dotTitle}
                          style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: dotColor,
                            flexShrink: 0,
                            boxShadow: dotColor !== '#2a4060' ? `0 0 4px ${dotColor}88` : 'none',
                          }}
                        />
                        <span
                          className={`flex-1 truncate cursor-pointer text-[10px] transition-colors
                            ${feed.enabled ? 'text-[#a8c4d8]' : 'text-[#2a4060]'}`}
                          onClick={() => toggleFeed(i)} title={feed.url}
                        >
                          {feed.name}
                        </span>
                        <button
                          onClick={() => deleteFeed(i)} disabled={isLoading}
                          className="text-[#4a6070] hover:text-[#ff4d4d] transition-colors text-[10px] flex-shrink-0"
                          title={t('config.feed.remove')}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>

                {/* Add feed */}
                <div className="flex gap-2">
                  <input
                    type="text" value={newFeedName}
                    onChange={(e) => setNewFeedName(e.target.value)}
                    placeholder={t('config.feed.namePlaceholder')}
                    className="argus-input border rounded px-2 py-1.5 transition-colors w-[30%] text-[10px]"
                    disabled={isLoading}
                    onKeyDown={(e) => e.key === 'Enter' && addFeed()}
                  />
                  <input
                    type="text" value={newFeedUrl}
                    onChange={(e) => setNewFeedUrl(e.target.value)}
                    placeholder={t('config.feed.urlPlaceholder')}
                    className="argus-input border rounded px-2 py-1.5 transition-colors flex-1 text-[10px]"
                    disabled={isLoading}
                    onKeyDown={(e) => e.key === 'Enter' && addFeed()}
                  />
                  <button
                    onClick={addFeed}
                    disabled={isLoading || !newFeedName.trim() || !newFeedUrl.trim()}
                    className="px-2 py-1.5 border rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-[rgba(0,212,255,0.4)] text-[#00d4ff] hover:bg-[rgba(0,212,255,0.08)] text-[10px] flex-shrink-0"
                  >
                    {t('config.feed.add')}
                  </button>
                </div>
              </div>

              {/* Prediction source */}
              {predictionProvider !== null && providersAvailable.length > 1 && (
                <div>
                  <SectionTitle label={t('config.sections.prediction', 'PREDICTION SOURCE')} />
                  <div className="text-[#2a4060] text-[11px] mb-2 leading-relaxed">
                    {/* The reason this is a setting at all, stated where the
                        choice is made. Without it the two options look like a
                        matter of taste, and a reader whose panel is empty has
                        no way to guess that the fix is here. */}
                    {t('config.prediction.description',
                       'Which exchange the prediction panel reads. Polymarket is blocked by some networks and carries more live geopolitics; Kalshi resolves more widely and is deeper on politics and the economy. Each has its own watchlist.')}
                  </div>
                  <div className="flex rounded overflow-hidden" style={{ border: '1px solid rgba(0,180,255,0.15)' }}>
                    {providersAvailable.map((name, i) => (
                      <button
                        key={name}
                        onClick={() => { setPredictionProvider(name); setDirty(true) }}
                        disabled={isLoading}
                        className="flex-1 text-[11px] tracking-[0.08em] py-1"
                        style={{
                          color: predictionProvider === name ? '#ffb347' : '#2a5070',
                          background: predictionProvider === name ? 'rgba(255,179,71,0.12)' : 'transparent',
                          borderLeft: i > 0 ? '1px solid rgba(0,180,255,0.12)' : 'none',
                          cursor: 'pointer',
                        }}
                      >{name.toUpperCase()}</button>
                    ))}
                  </div>
                  {predictionProvider !== savedPredictionProvider.current && (
                    <span className="text-[#2a4060] text-[11px] mt-1 block">
                      {/* Switching swaps the watchlist as well as the source, so
                          the panel comes back with different questions rather
                          than the same ones repriced. Worth saying before the
                          reader wonders where their rows went. */}
                      {t('config.prediction.switchNote',
                         'The panel will show this source’s own watchlist.')}
                    </span>
                  )}
                </div>
              )}

              {/* Webhook */}
              {serviceHealth.webhookEnabled && (
                <div>
                  <SectionTitle label={t('config.sections.webhook')} />
                  <div className="text-[#2a4060] text-[11px] mb-2 leading-relaxed">
                    {t('config.webhook.description')}
                    <code className="block mt-1 text-[#4a6070] bg-[rgba(0,180,255,0.05)] border border-[rgba(0,180,255,0.12)] rounded px-2 py-1">
                      POST {API}/api/events/webhook
                    </code>
                  </div>
                  <button
                    onClick={() => {
                      const cmd = `curl -X POST ${API}/api/events/webhook \\
  -H 'Content-Type: application/json' \\
  -H 'X-Webhook-Key: <YOUR_KEY>' \\
  -d '{"title":"Test Event","category":"POLITICAL","intensity":"MODERATE"}'`
                      void copyToClipboard(cmd).then((ok) => {
                        if (ok) { setCurlCopied(true); setTimeout(() => setCurlCopied(false), 2000) }
                      })
                    }}
                    className="px-3 py-1 text-[11px] tracking-widest border rounded transition-colors border-[rgba(0,180,255,0.2)] text-[#2a5070] hover:text-[#00d4ff] hover:border-[rgba(0,212,255,0.4)]"
                  >
                    {curlCopied ? t('config.webhook.copied') : t('config.webhook.copyCurl')}
                  </button>
                </div>
              )}
            </div>

            {/* ── RIGHT: Display + Azure Speech — display/presentation settings,
                kept apart from the LLM/feeds/webhook backend integrations on
                the left so the two columns run roughly even. ── */}
            <div className="space-y-6">

              {/* Display */}
              <div>
                <SectionTitle label={t('config.sections.display')} />
                <label className="block">
                  <FieldLabel text={t('config.fields.uiScale')} value={`${Math.round(localScale * 100)}%`} />
                  <input
                    type="range" min={0.75} max={1.5} step={0.05}
                    value={localScale}
                    onChange={(e) => { setLocalScale(parseFloat(e.target.value)); setDirty(true) }}
                    className="w-full cursor-pointer"
                  />
                  <div className="flex justify-between text-[#2a4060] text-[11px] mt-0.5">
                    <span>75%</span><span>100%</span><span>150%</span>
                  </div>
                </label>

                {/* Startup view */}
                <div className="mt-3 pt-3 border-t border-[rgba(0,180,255,0.08)]">
                  <FieldLabel text={t('config.fields.homeView', 'STARTUP VIEW')} />
                  <div className="flex rounded overflow-hidden" style={{ border: '1px solid rgba(0,180,255,0.15)' }}>
                    {([
                      { v: 'earth', label: t('config.fields.homeViewEarth', 'EARTH') },
                      { v: 'solar', label: t('config.fields.homeViewSolar', 'SOLAR SYSTEM') },
                    ] as const).map(({ v, label }, i) => (
                      <button
                        key={v}
                        onClick={() => setHomeView(v)}
                        className="flex-1 text-[11px] tracking-[0.08em] py-1"
                        style={{
                          color: homeView === v ? '#00d4ff' : '#2a5070',
                          background: homeView === v ? 'rgba(0,212,255,0.12)' : 'transparent',
                          borderLeft: i > 0 ? '1px solid rgba(0,180,255,0.12)' : 'none',
                          cursor: 'pointer',
                        }}
                      >{label}</button>
                    ))}
                  </div>
                  <p className="text-[10px] mt-1 leading-snug" style={{ color: '#2a4a63' }}>
                    {t('config.fields.homeViewHint', 'Applies on next load. Earth lands at working altitude with the political layer and markers live.')}
                  </p>
                </div>

                {/* Price colours. Labelled by region rather than by colour,
                    because "green means up" is not a preference anyone holds
                    in the abstract — it is the convention of the markets they
                    read. */}
                <div className="mt-3 pt-3 border-t border-[rgba(0,180,255,0.08)]">
                  <FieldLabel text={t('config.fields.upColor', 'PRICE COLOURS')} />
                  <div className="flex rounded overflow-hidden" style={{ border: '1px solid rgba(0,180,255,0.15)' }}>
                    {([
                      { v: 'green', label: t('config.fields.upColorGreen', 'GREEN UP (US / EU)') },
                      { v: 'red',   label: t('config.fields.upColorRed',   'RED UP (TW / JP)') },
                    ] as const).map(({ v, label }, i) => (
                      <button
                        key={v}
                        onClick={() => setUpColor(v)}
                        className="flex-1 text-[11px] tracking-[0.08em] py-1"
                        style={{
                          color: upColor === v ? '#00d4ff' : '#2a5070',
                          background: upColor === v ? 'rgba(0,212,255,0.12)' : 'transparent',
                          borderLeft: i > 0 ? '1px solid rgba(0,180,255,0.12)' : 'none',
                          cursor: 'pointer',
                        }}
                      >{label}</button>
                    ))}
                  </div>
                </div>

                {/* Motion + audio — applied immediately, not on Apply, so the
                    effect of the toggle is visible while the dialog is open. */}
                <div className="mt-3 pt-3 border-t border-[rgba(0,180,255,0.08)]">
                  <ToggleRow
                    label={t('config.fields.decorativeFx', 'Decorative motion')}
                    hint={t('config.fields.decorativeFxHint', 'Hover tilt, sheen and staggered reveals. Alerts, arrivals and loading states always animate.')}
                    checked={decorativeFx}
                    onChange={setDecorativeFx}
                  />
                  {/* Backdrop strength. Pure taste, so it gets a control
                      rather than a number someone has to argue me into. */}
                  <div className="pt-1">
                    <FieldLabel
                      text={t('config.fields.nebula', 'BACKDROP NEBULA')}
                      value={nebulaIntensity === 0
                        ? t('config.fields.nebulaOff', 'OFF')
                        : `${Math.round(nebulaIntensity * 100)}%`}
                    />
                    <input
                      type="range" min={0} max={2} step={0.05}
                      value={nebulaIntensity}
                      onChange={(e) => setNebulaIntensity(parseFloat(e.target.value))}
                      className="w-full cursor-pointer"
                      style={{ ['--thumb-color' as string]: '#9b6dff', ['--thumb-glow' as string]: 'rgba(155,109,255,0.6)' }}
                    />
                    <div className="flex justify-between text-[#2a4060] text-[10px] mt-0.5">
                      <span>{t('config.fields.nebulaOff', 'OFF')}</span>
                      <span>100%</span>
                      <span>200%</span>
                    </div>
                  </div>

                  <ToggleRow
                    label={t('config.fields.sound', 'Alert sound')}
                    hint={t('config.fields.soundHint', 'A low tone when a CRITICAL or HIGH event arrives, plus a quiet confirm click. Nothing else makes a sound.')}
                    checked={soundEnabled}
                    onChange={(v) => { setSoundEnabled(v); if (v) preview('alert') }}
                    accent="#ffd426"
                  />
                  {soundEnabled && (
                    <div className="pl-[36px] mt-1">
                      <FieldLabel
                        text={t('config.fields.soundVolume', 'VOLUME')}
                        value={`${Math.round(soundVolume * 100)}%`}
                      />
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={soundVolume}
                        onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                        className="w-full cursor-pointer"
                        style={{ ['--thumb-color' as string]: '#ffd426', ['--thumb-glow' as string]: 'rgba(255,212,38,0.6)' }}
                      />
                      <div className="flex gap-2 mt-1.5">
                        <button
                          onClick={() => preview('alert')}
                          className="text-[10px] tracking-[0.08em] px-2 py-0.5 rounded"
                          style={{ color: '#ffd426', border: '1px solid rgba(255,212,38,0.3)', background: 'rgba(255,212,38,0.08)', cursor: 'pointer' }}
                        >{t('config.fields.testAlert', 'TEST ALERT')}</button>
                        <button
                          onClick={() => preview('tick')}
                          className="text-[10px] tracking-[0.08em] px-2 py-0.5 rounded"
                          style={{ color: '#4a6070', border: '1px solid rgba(0,180,255,0.15)', background: 'none', cursor: 'pointer' }}
                        >{t('config.fields.testTick', 'TEST CLICK')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Azure Speech */}
              {azureSpeech && (
                <div>
                  <SectionTitle label={t('config.sections.azureSpeech', 'Azure Speech')} />
                  <p className="text-[10px] mb-2 leading-snug" style={{ color: '#2a4a63' }}>
                    {t('config.fields.azureSpeechHint', 'Reads the intel brief aloud when opened, using Azure Cognitive Services Speech.')}
                  </p>

                  <label className="block mb-2.5">
                    <FieldLabel text={t('config.fields.azureSpeechKey', 'API KEY')} />
                    <input
                      type="password" value={azureKeyInput}
                      onChange={(e) => { setAzureKeyInput(e.target.value); setDirty(true) }}
                      className="argus-input w-full border rounded px-2 py-1.5 transition-colors"
                      placeholder={azureSpeech.hasKey
                        ? t('config.fields.azureSpeechKeySet', '•••• configured — leave blank to keep')
                        : t('config.fields.azureSpeechKeyPlaceholder', 'Subscription key')}
                      disabled={isLoading}
                      autoComplete="off"
                    />
                  </label>

                  <label className="block mb-2.5">
                    <FieldLabel text={t('config.fields.azureSpeechRegion', 'REGION')} />
                    <input
                      type="text" value={azureSpeech.region}
                      onChange={(e) => patchAzure('region', e.target.value)}
                      className="argus-input w-full border rounded px-2 py-1.5 transition-colors"
                      placeholder={t('config.fields.azureSpeechRegionPlaceholder', 'eastasia')}
                      disabled={isLoading}
                    />
                  </label>

                  <label className="block">
                    <FieldLabel text={t('config.fields.azureSpeechVoice', 'VOICE')} />
                    <select
                      value={azureSpeech.voice}
                      onChange={(e) => patchAzure('voice', e.target.value)}
                      className="argus-input w-full border rounded px-2 py-1.5 transition-colors appearance-none cursor-pointer"
                      disabled={isLoading}
                    >
                      {AZURE_VOICE_IDS.map((id) => (
                        <option key={id} value={id}>{t(`config.azureVoice.${id}`, id)}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

            </div>{/* end right column */}
          </div>{/* end grid */}

          {errMsg && status === 'error' && (
            <p className="mx-6 mb-4 text-[#ff4d4d] text-[10px] border border-[rgba(255,77,77,0.2)] rounded px-3 py-2">
              ⚠ {errMsg}
            </p>
          )}

          {/* Footer */}
          <div
            className="flex items-center justify-between px-6 py-3.5 border-t border-[rgba(0,180,255,0.12)] sticky bottom-0 z-20"
            style={{ background: '#04090e' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-[11px] tracking-widest">
                {status === 'saving' && <span className="text-[#00d4ff]">{t('config.status.saving')}</span>}
                {status === 'idle' && !dirty && <span className="text-[#2a4060]">{t('config.status.noChanges')}</span>}
                {status === 'idle' &&  dirty && <span className="text-[#ff9c2a]">{t('config.status.unsaved')}</span>}
              </span>
              <a
                href={`${API}/api/events/export?format=json`}
                download
                className="text-[#2a4060] hover:text-[#4a6070] transition-colors text-[11px] tracking-widest"
                title={`Download all ${allEvents.length} events as JSON`}
              >↓ JSON</a>
              <a
                href={`${API}/api/events/export?format=csv`}
                download
                className="text-[#2a4060] hover:text-[#4a6070] transition-colors text-[11px] tracking-widest"
                title={`Download all ${allEvents.length} events as CSV`}
              >↓ CSV</a>
              {hasActiveFilter && (
                <>
                  <a
                    href={`${API}/api/events/export?format=json&ids=${encodeURIComponent(filteredIds)}`}
                    download
                    className="text-[#2a4060] hover:text-[#4a6070] transition-colors text-[11px] tracking-widest"
                    title={`Download filtered ${filteredEvents.length} events as JSON`}
                  >↓ JSON ({filteredEvents.length})</a>
                  <a
                    href={`${API}/api/events/export?format=csv&ids=${encodeURIComponent(filteredIds)}`}
                    download
                    className="text-[#2a4060] hover:text-[#4a6070] transition-colors text-[11px] tracking-widest"
                    title={`Download filtered ${filteredEvents.length} events as CSV`}
                  >↓ CSV ({filteredEvents.length})</a>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-[10px] tracking-widest text-[#4a6070] border border-[rgba(0,180,255,0.15)] rounded hover:text-[#a8c4d8] hover:border-[rgba(0,180,255,0.3)] transition-colors"
              >
                {t('config.actions.cancel')}
              </button>
              <button
                onClick={handleApply}
                disabled={!dirty || isLoading}
                className="px-4 py-1.5 text-[10px] tracking-widest border rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-[rgba(0,212,255,0.45)] text-[#00d4ff] hover:bg-[rgba(0,212,255,0.1)]"
              >
                {t('config.actions.apply')}
              </button>
            </div>
          </div>

        </div>{/* end scrollable */}
      </div>
    </div>
  )
}
