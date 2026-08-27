import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { SolarSystem } from './components/scene/SolarSystem'
import { Nebula } from './components/scene/Nebula'
import { EventPanel } from './components/panels/EventPanel'
import { RegionPanel } from './components/panels/RegionPanel'
import { PredictionPanel } from './components/panels/PredictionPanel'
import { Sidebar } from './components/ui/Sidebar'
import { StatusBar, STATUS_BAR_H } from './components/ui/StatusBar'
import { LanguageSwitcher } from './components/ui/LanguageSwitcher'
import { AnnotationToolbar } from './components/ui/AnnotationToolbar'
import { CelestialNavList } from './components/ui/CelestialNavList'
import { ConfigModal } from './components/ui/ConfigModal'
import { EventStack } from './components/ui/EventStack'
import { CategoryFilterBar } from './components/ui/CategoryFilterBar'
import { FloatDock } from './components/ui/FloatDock'
import { TimeScrubber } from './components/ui/TimeScrubber'
import { CanvasAnalysisPanel } from './components/ui/CanvasAnalysisPanel'
import { CelestialBodyPanel } from './components/panels/CelestialBodyPanel'
import { WikiPanel } from './components/panels/WikiPanel'
import { MultiEntityContextPanel } from './components/panels/MultiEntityContextPanel'
import { ToastContainer } from './components/ui/ToastContainer'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal'
import { useAppStore, showsChrome, showsSidebar } from './store'
import { useOllamaSocket } from './hooks/useOllamaSocket'
import { usePopoutSync } from './hooks/usePopoutSync'
import { useFilteredEvents } from './hooks/useFilteredEvents'
import { useArgusSound } from './hooks/useArgusSound'
import './i18n'

export default function App() {
  useOllamaSocket()
  usePopoutSync('host')
  useArgusSound()
  const decorativeFx = useAppStore((s) => s.decorativeFx)

  // Expose the motion preference to CSS so class-based decorative animation can
  // be switched off without every component having to read the store.
  useEffect(() => {
    document.documentElement.dataset.fx = decorativeFx ? 'on' : 'off'
  }, [decorativeFx])
  const showConfig    = useAppStore((s) => s.showConfig)
  const setShowConfig = useAppStore((s) => s.setShowConfig)
  const uiScale       = useAppStore((s) => s.uiScale)
  const hudMode         = useAppStore((s) => s.hudMode)
  const setHudMode      = useAppStore((s) => s.setHudMode)
  const toggleImmersive = useAppStore((s) => s.toggleImmersive)
  const [showCanvasAnalysis, setShowCanvasAnalysis] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  const activePanelId       = useAppStore((s) => s.activePanelId)
  const setActivePanelId    = useAppStore((s) => s.setActivePanelId)
  const setSelectedCountry  = useAppStore((s) => s.setSelectedCountry)
  const clearSelectedEntities = useAppStore((s) => s.clearSelectedEntities)
  const toggleBookmark      = useAppStore((s) => s.toggleBookmark)
  const filteredEvents      = useFilteredEvents()

  // ── Global keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

      // ? → keyboard shortcuts overlay
      if (e.key === '?' && !inInput) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }

      // / → focus search (works even from outside inputs)
      if (e.key === '/' && !inInput) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('argus:focus-search'))
        return
      }

      // All other shortcuts ignored while typing
      if (inInput) return

      switch (e.key) {
        case 'Escape':
          // Close panels in reverse open order
          if (activePanelId) { setActivePanelId(null); break }
          setSelectedCountry(null)
          clearSelectedEntities()
          break

        case 'i':
        case 'I':
          toggleImmersive()
          break

        case 'b':
        case 'B':
          if (activePanelId) toggleBookmark(activePanelId)
          break

        case '[': {
          if (filteredEvents.length === 0) break
          const idx = filteredEvents.findIndex(ev => ev.id === activePanelId)
          const prev = idx <= 0 ? filteredEvents[filteredEvents.length - 1] : filteredEvents[idx - 1]
          setActivePanelId(prev.id)
          break
        }
        case ']': {
          if (filteredEvents.length === 0) break
          const idx = filteredEvents.findIndex(ev => ev.id === activePanelId)
          const next = idx < 0 || idx >= filteredEvents.length - 1 ? filteredEvents[0] : filteredEvents[idx + 1]
          setActivePanelId(next.id)
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleImmersive,
      activePanelId, setActivePanelId, setSelectedCountry, clearSelectedEntities,
      toggleBookmark, filteredEvents, showShortcuts])

  return (
    <div className="fixed inset-0 bg-[#04060f] overflow-hidden">
      {/* ── 3-D Solar System Canvas ───────────────────────────────────── */}
      {/* No `shadows` prop: nothing in the scene casts a shadow map. Saturn's
          globe and rings shadow each other analytically in their materials
          (see components/scene/ringShadow.ts), and no other pair of bodies is
          close enough for an occlusion to be anything but invented. */}
      <Canvas
        camera={{ position: [0, 180, 520], fov: 55, near: 0.01, far: 200000 }}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
      >
        <Suspense fallback={null}>
          <Nebula />
          <Stars radius={8000} depth={80} count={16000} factor={3} saturation={0.15} speed={0} />
          <Stars radius={3000} depth={40} count={4000}  factor={5} saturation={0.1}  speed={0} />
          <SolarSystem />
        </Suspense>
      </Canvas>

      {/* ── Annotation toolbar (3D pins live inside Canvas; toolbar is DOM overlay) ── */}
      <AnnotationToolbar />

      {/* ── Toast notifications (outside HUD scale, always visible) ─────── */}
      <ToastContainer />

      {/* ── Keyboard shortcuts overlay ───────────────────────────────────── */}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* ── Scaled HUD layer ─────────────────────────────────────────────── */}
      <ErrorBoundary label="HUD">
      <div style={{ zoom: uiScale }}>

        {/* ── Chrome: the readouts and controls the reduced modes shed ──── */}
        {showsChrome(hudMode) && (
          <StatusBar
            onOpenConfig={() => setShowConfig(true)}
            onToggleCanvasAnalysis={() => setShowCanvasAnalysis(v => !v)}
            canvasAnalysisOpen={showCanvasAnalysis}
            onEnterImmersive={() => setHudMode('immersive')}
            languageSwitcher={<LanguageSwitcher />}
          />
        )}

        {/* ── The feed: sidebar at full, icon stack once reduced ────────── */}
        {showsSidebar(hudMode) ? <Sidebar /> : <EventStack />}

        {/* Restore control. Only in compact — immersive is left via the dock
            or `I`, and a button pinned to the corner would be the one piece
            of chrome that mode exists to be rid of. */}
        {hudMode === 'compact' && (
          <button
            onClick={() => setHudMode('full')}
            title="Normal mode"
            style={{ width: '28px', height: '28px', top: `${STATUS_BAR_H + 8}px`, left: '8px' }}
            className="absolute z-50 flex items-center justify-center text-[#4a6070] hover:text-[#00d4ff] border border-[rgba(0,180,255,0.15)] hover:border-[rgba(0,180,255,0.4)] rounded transition-colors bg-[rgba(4,9,22,0.8)] text-[13px] font-mono"
          >
            ☰
          </button>
        )}

        {showsChrome(hudMode) && (
          <>
            <CategoryFilterBar />
            <ErrorBoundary label="Time Scrubber"><TimeScrubber /></ErrorBoundary>
            <CelestialNavList />
          </>
        )}

        {/* ── Always present: the dock is how immersive stays navigable, and
               the panels have to stay reachable from it ─────────────────── */}
        <FloatDock />
        <ErrorBoundary label="Event Panel"><EventPanel /></ErrorBoundary>
        <ErrorBoundary label="Region Panel"><RegionPanel /></ErrorBoundary>
        <ErrorBoundary label="Celestial Panel"><CelestialBodyPanel /></ErrorBoundary>
        <ErrorBoundary label="Person Panel"><WikiPanel /></ErrorBoundary>
        <ErrorBoundary label="Context Panel"><MultiEntityContextPanel /></ErrorBoundary>
        <ErrorBoundary label="Prediction Panel"><PredictionPanel /></ErrorBoundary>

        {showConfig && <ConfigModal />}
        {showCanvasAnalysis && <CanvasAnalysisPanel onClose={() => setShowCanvasAnalysis(false)} />}

      </div>{/* end scaled HUD layer */}
      </ErrorBoundary>
    </div>
  )
}
