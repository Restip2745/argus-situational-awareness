/**
 * The model now classifies, translates and summarises in a single call. The
 * translation half is the fragile one — these cover the ways a small model
 * fails at it, and assert that none of them cost us the classification.
 */
import { describe, it, expect } from 'vitest'
import { validateClassification } from '../services/ollama'

const good = {
  category: 'ARMED_CONFLICT',
  intensity: 'HIGH',
  title_zh: '烏克蘭東部發生激烈戰鬥',
  summary_en: 'Heavy fighting was reported in eastern Ukraine overnight.',
  summary_zh: '烏東地區昨夜傳出激烈交火。',
  location: { type: 'geo', label: 'Ukraine', lat: 48.4, lng: 37.8, body: null },
  actors: ['Ukraine', 'Russia'],
  sources_count: 2,
  tags: ['military', 'frontline'],
  reliability: 'MEDIUM',
}

describe('validateClassification — bilingual fields', () => {
  it('keeps well-formed output intact', () => {
    const r = validateClassification(good)
    expect(r.title_zh).toBe('烏克蘭東部發生激烈戰鬥')
    expect(r.summary_zh).toBe('烏東地區昨夜傳出激烈交火。')
    expect(r.summary_en).toBe('Heavy fighting was reported in eastern Ukraine overnight.')
    expect(r.category).toBe('ARMED_CONFLICT')
  })

  // A small model asked for Chinese will sometimes just echo English. Storing
  // that would show the same sentence for both languages while looking correct.
  it('drops Chinese fields that contain no Chinese', () => {
    const r = validateClassification({
      ...good, title_zh: 'Fighting in eastern Ukraine', summary_zh: 'Heavy fighting reported.',
    })
    expect(r.title_zh).toBe('')
    expect(r.summary_zh).toBe('')
    expect(r.summary_en).toBe(good.summary_en)   // English side unaffected
  })

  it('drops non-string and rambling output instead of storing it', () => {
    expect(validateClassification({ ...good, title_zh: 42 }).title_zh).toBe('')
    expect(validateClassification({ ...good, summary_en: null }).summary_en).toBe('')
    expect(validateClassification({ ...good, summary_en: 'x'.repeat(500) }).summary_en).toBe('')
  })

  it('truncates merely-overlong text rather than discarding it', () => {
    const long = '這是一段中文摘要。'.repeat(20)          // 180 chars: over 120, under 240
    const r = validateClassification({ ...good, summary_zh: long })
    expect(r.summary_zh.length).toBe(120)
  })

  it('collapses whitespace so multi-line output does not break layout', () => {
    const r = validateClassification({ ...good, summary_en: '  Two   lines\n  of text  ' })
    expect(r.summary_en).toBe('Two lines of text')
  })

  // The whole point of the guards: a failed translation must not take the
  // classification down with it.
  it('still classifies when every text field is garbage', () => {
    const r = validateClassification({
      ...good, title_zh: null, summary_zh: 12, summary_en: undefined,
    })
    expect(r.title_zh).toBe('')
    expect(r.summary_zh).toBe('')
    expect(r.summary_en).toBe('')
    expect(r.category).toBe('ARMED_CONFLICT')
    expect(r.intensity).toBe('HIGH')
    expect(r.actors).toEqual(['Ukraine', 'Russia'])
  })
})

/**
 * Simplified characters leaking into a zh-TW field.
 *
 * The prompt asks for Taiwanese conventions and both models mostly comply, but
 * a sweep of 1693 stored and replayed Chinese strings turned up six that carry
 * Simplified forms mid-sentence — one of them almost entirely Simplified. The
 * earlier guard only asked whether the text contained Han characters at all,
 * which every one of these passes, so they reached the database and the globe
 * looking like any other translation.
 *
 * The fixtures below are those actual strings, not invented ones.
 */
describe('validateClassification — Simplified leakage', () => {
  const leaked = {
    oxygen: '加薩醫院面臨氧氣短缺，危及早产儿和危重病患，醫療體系瀕臨崩潰。',
    sudan:  '南蘇丹發生伏擊事件，有武装人员袭击维和部队，造成伤亡，加剧了该国重回内战的担忧。',
    iran:   '針對伊朗航空、科技與航运部门的新制裁正加剧全球市场与能源价格压力。',
  }

  it.each(Object.entries(leaked))('drops the %s summary', (_name, summary_zh) => {
    expect(validateClassification({ ...good, summary_zh }).summary_zh).toBe('')
  })

  it('drops a Simplified title', () => {
    expect(validateClassification({ ...good, title_zh: '乌克兰东部发生激烈战斗' }).title_zh).toBe('')
  })

  // The leak must cost the translation and nothing else — the classification is
  // the part that has been working for months.
  it('leaves the classification and the English side intact', () => {
    const r = validateClassification({ ...good, summary_zh: leaked.iran })
    expect(r.summary_zh).toBe('')
    expect(r.title_zh).toBe(good.title_zh)
    expect(r.category).toBe('ARMED_CONFLICT')
    expect(r.intensity).toBe('HIGH')
    expect(r.summary_en).toBe(good.summary_en)
  })

  /**
   * Characters that exist in both scripts are deliberately not caught. 後/后,
   * 幹/干, 裡/里, 麵/面 and 豐/丰 all have a Traditional reading, and rejecting
   * them would throw away correct text to chase a rarer fault.
   */
  it('passes Traditional text that uses both-script characters', () => {
    for (const title_zh of ['颱風過後干道積水嚴重', '里長會勘麵店後巷', '豐原車站前面施工']) {
      expect(validateClassification({ ...good, title_zh }).title_zh).toBe(title_zh)
    }
  })
})
