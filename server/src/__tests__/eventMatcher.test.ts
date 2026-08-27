/**
 * The matcher's job is to be right about "same happening", and its failure mode
 * matters more than its hit rate: a missed match leaves the duplicate marker
 * the globe already draws, a wrong one merges two real events into one. These
 * cover the guards that keep it failing the first way, and the three extraction
 * faults found by replaying 453 stored articles.
 */
import { describe, it, expect } from 'vitest'
import { extractTerms, findEvent } from '../services/eventMatcher'
import type { Article, EventCategory } from '../types'

let seq = 0
function article(over: Partial<Article> & { title: string }): Article {
  seq++
  return {
    id: `id-${seq}`,
    source: 'BBC World',
    content: null,
    url: `https://example.test/${seq}`,
    published_at: '2026-08-24T12:00:00Z',
    fetched_at: '2026-08-24T12:05:00Z',
    is_analyzed: 1,
    category: 'ENVIRONMENT',
    title_zh: null, summary_zh: null, summary_en: null,
    intensity: 'HIGH',
    location_type: 'geo', location_label: null, lat: null, lng: null,
    geo_precision: null, body: null, actors: null, tags: null,
    sources_count: 1, reliability: 'MEDIUM', market_link: null,
    event_id: null, image_url: null,
    heat_score: 0.5, expires_at: null, last_referenced: null,
    ...over,
  }
}

/** Filler so document frequency has something to measure. Each names its own
 *  distinct thing, so none of them should ever join anything. */
function filler(n: number): Article[] {
  const places = ['Reykjavik', 'Valparaiso', 'Kandahar', 'Trondheim', 'Salvador',
    'Bratislava', 'Nagasaki', 'Windhoek', 'Asuncion', 'Tampere', 'Kaunas',
    'Bergen', 'Cordoba', 'Utrecht', 'Aarhus', 'Malmo', 'Ghent', 'Porto',
    'Leipzig', 'Bilbao', 'Odense', 'Turku', 'Split', 'Nantes', 'Graz']
  return places.slice(0, n).map((p, i) =>
    article({
      title: `${p} council approves the ${p} bridge scheme`,
      source: i % 2 ? 'Reuters' : 'BBC World',
      event_id: `filler-${p}`,
      category: 'POLITICAL',
    }))
}

describe('extractTerms', () => {
  // A capital inside a word ended the match early and left the fragment
  // behind, which joined a hospital fire to a pornography earnings story.
  it('does not slice a fragment out of a mid-word capital', () => {
    const t = extractTerms({ title: 'An OnlyFans owner earned millions', summary_en: null, content: null })
    expect(t.has('Only')).toBe(false)
    expect([...t].some((x) => x.startsWith('You'))).toBe(false)
  })

  // The stop list rejected `Les` alone, so `Les États-Unis` survived whole and
  // escaped the weighting that any country name would have received.
  it('strips a leading article from a multi-word name', () => {
    const t = extractTerms({ title: 'Les États-Unis annoncent des sanctions', summary_en: null, content: null })
    expect(t.has('Les États-Unis')).toBe(false)
    expect(t.has('États-Unis')).toBe(true)
  })

  it('keeps real names and drops sentence openers', () => {
    const t = extractTerms({
      title: 'The rescue in Conakry continues',
      summary_en: 'Dolly Parton was not involved.',
      content: null,
    })
    expect(t.has('Conakry')).toBe(true)
    expect(t.has('Dolly Parton')).toBe(true)
    expect(t.has('The')).toBe(false)
  })

  it('reads only the head of the body', () => {
    const t = extractTerms({
      title: 'Landfill collapse',
      summary_en: null,
      content: `${'padding word '.repeat(120)}Timbuktu`,
    })
    expect(t.has('Timbuktu')).toBe(false)
  })
})

describe('findEvent', () => {
  const collapse = (over: Partial<Article> = {}) => article({
    title: 'Conakry landfill collapse kills dozens in Guinea',
    summary_en: 'A waste mound at the Conakry landfill buried homes.',
    category: 'ENVIRONMENT',
    ...over,
  })

  it('starts its own event when the window is too small to judge rarity', () => {
    const pool = filler(5).map((a) => ({ ...a, event_id: 'e1' }))
    expect(findEvent(collapse(), pool)).toBeNull()
  })

  it('joins an event that names the same particulars', () => {
    const pool = [
      ...filler(24),
      collapse({ source: 'Reuters', event_id: 'guinea', title: 'Rescuers search Conakry landfill in Guinea' }),
      collapse({ source: 'Al Jazeera', event_id: 'guinea', title: 'Conakry landfill collapse in Guinea kills 30' }),
    ]
    expect(findEvent(collapse({ source: 'France 24' }), pool)).toBe('guinea')
  })

  // One fire, filed under SOCIAL by one outlet and HEALTH by another, is still
  // one fire. Category cuts across events rather than between them, so it does
  // not gate — place and rare names decide.
  it('joins across a disagreement about category', () => {
    const pool = [
      ...filler(24),
      collapse({ source: 'Reuters', event_id: 'guinea', category: 'SOCIAL' }),
      collapse({ source: 'Al Jazeera', event_id: 'guinea', category: 'SOCIAL' }),
    ]
    expect(findEvent(collapse({ category: 'HEALTH' }), pool)).toBe('guinea')
  })

  // The plainest signal, and the one that was missing: a landfill collapse in
  // Conakry had been filed with floods in Venezuela and snow in Bolivia.
  it('refuses an event on the other side of the world', () => {
    const conakry = { lat: 9.53, lng: -13.67 }
    const pool = [
      ...filler(24),
      collapse({ source: 'Reuters', event_id: 'guinea', ...conakry }),
      collapse({ source: 'Al Jazeera', event_id: 'guinea', ...conakry }),
    ]
    // Same words, same day, 5,900km away.
    expect(findEvent(collapse({ lat: 8.0, lng: -66.0 }), pool)).toBeNull()
  })

  it('counts being in the same place as evidence', () => {
    const conakry = { lat: 9.53, lng: -13.67 }
    const pool = [
      ...filler(24),
      article({ title: 'Guinea landfill disaster', summary_en: 'A collapse in Guinea.',
        source: 'Reuters', event_id: 'guinea', ...conakry }),
      article({ title: 'Guinea landfill disaster toll rises', summary_en: 'A collapse in Guinea.',
        source: 'Al Jazeera', event_id: 'guinea', ...conakry }),
    ]
    // Shares only the country, which alone would not clear the bar.
    const thin = article({ title: "Rescuers search Guinea's capital", summary_en: null,
      source: 'France 24', ...conakry })
    expect(findEvent(thin, pool)).toBe('guinea')
  })

  it('refuses an event that has drifted outside the window', () => {
    const old = { published_at: '2026-08-18T12:00:00Z' }
    const pool = [
      ...filler(24),
      collapse({ source: 'Reuters', event_id: 'guinea', ...old }),
      collapse({ source: 'Al Jazeera', event_id: 'guinea', ...old }),
    ]
    expect(findEvent(collapse(), pool)).toBeNull()
  })

  // An agency byline is carried by one outlet across unrelated stories. It
  // cannot evidence corroboration between outlets, which is the one thing the
  // count exists to measure.
  it('does not merge on a term only one outlet has ever used', () => {
    const byline = 'Reported by Wafaa Shurafa for the agency'
    const pool = [
      ...filler(24),
      article({
        title: `Israeli strike on a Gaza market ${byline}`,
        summary_en: byline,
        source: 'Associated Press', event_id: 'strike', category: 'ARMED_CONFLICT',
      }),
      article({
        title: `A year since the Gaza journalists died ${byline}`,
        summary_en: byline,
        source: 'Associated Press', event_id: 'strike', category: 'ARMED_CONFLICT',
      }),
    ]
    const candidate = article({
      title: `Gaza aid convoy halted ${byline}`,
      summary_en: byline,
      source: 'Associated Press', category: 'ARMED_CONFLICT',
    })
    expect(findEvent(candidate, pool)).toBeNull()
  })

  it('starts its own event when nothing in the window shares a name', () => {
    expect(findEvent(collapse(), filler(24))).toBeNull()
  })

  it('ignores articles that carry no event yet', () => {
    const pool = [
      ...filler(24),
      collapse({ source: 'Reuters', event_id: null }),
      collapse({ source: 'Al Jazeera', event_id: null }),
    ]
    expect(findEvent(collapse(), pool)).toBeNull()
  })
})
