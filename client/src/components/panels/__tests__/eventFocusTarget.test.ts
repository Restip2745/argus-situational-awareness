/**
 * The focus control has to agree with the marker layer about where an event is.
 * It did not: markers went through resolveOrbitalPlacement, which normalises the
 * model's prose ("Mars") onto the lowercase body ids, while focus read
 * `event.body` raw and cast it. A Mars event drew its marker on Mars and then
 * focused on nothing, with the button still looking live.
 */
import { describe, it, expect } from 'vitest'
import { resolveFocusTarget } from '../EventPanel'
import type { ArgusEvent } from '../../../types'

const base: ArgusEvent = {
  id: 'e1', title: 'T', title_zh: null, content: null,
  summary_zh: null, summary_en: null,
  source: 'S', url: 'https://example.com',
  published_at: '2026-08-25T00:00:00Z', fetched_at: '2026-08-25T00:00:00Z',
  category: 'SPACE', intensity: 'LOW',
  location_type: 'orbital', location_label: null,
  lat: null, lng: null, geo_precision: 'none', body: null,
  actors: [], tags: [], sources_count: 1, reliability: 'HIGH',
  image_url: null, heat_score: 0.4, expires_at: null, last_referenced: null,
}

describe('resolveFocusTarget', () => {
  it('flies to the surface point when the event has one', () => {
    expect(resolveFocusTarget({ ...base, location_type: 'geo', lat: 25, lng: 121 }))
      .toEqual({ kind: 'surface', lat: 25, lng: 121 })
  })

  // The reported case: "Perseverance Captures Another Phobos Transit", stored
  // with body 'Mars' — capitalised, as the model writes it.
  it('normalises the model\'s prose body name onto a body id', () => {
    expect(resolveFocusTarget({ ...base, body: 'Mars', location_label: 'Mars' }))
      .toEqual({ kind: 'body', body: 'mars' })
  })

  it('resolves a body named only in the location label', () => {
    expect(resolveFocusTarget({ ...base, body: null, location_label: 'Mars System' }))
      .toEqual({ kind: 'body', body: 'mars' })
  })

  // Satellites and launches ride above Earth rather than on it, so Earth is
  // the anchor to fly to. These used to offer no focus control at all.
  it('anchors Earth-orbit events on Earth', () => {
    expect(resolveFocusTarget({ ...base, location_label: 'Low-Earth Orbit' }))
      .toEqual({ kind: 'body', body: 'earth' })
    expect(resolveFocusTarget({ ...base, location_label: 'Earth Orbit' }))
      .toEqual({ kind: 'body', body: 'earth' })
  })

  it('offers no target for events with no position to fly to', () => {
    // Deep space has no ephemeris entry — the marker sits at a fixed point.
    expect(resolveFocusTarget({ ...base, body: 'Carina Nebula', location_label: 'Carina Nebula' }))
      .toBeNull()
    expect(resolveFocusTarget({ ...base, location_label: 'Space Industry' })).toBeNull()
    expect(resolveFocusTarget(base)).toBeNull()
  })
})
