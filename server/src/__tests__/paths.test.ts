/**
 * Guards the single-database invariant.
 *
 * ARGUS once ran with two: the server resolved its path from `process.cwd()`
 * and so wrote server/intelligence.db, while the harnesses in scripts/ built
 * their own paths and read a copy at the repo root that had stopped being
 * updated days earlier — and reported its numbers as if they were live. The
 * fix was one resolver; these tests are what stop a second one appearing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { resolveDbPath, DATA_DIR } from '../config/paths'

const REPO_ROOT = join(__dirname, '../../..')

afterEach(() => { delete process.env.DB_PATH })

describe('resolveDbPath', () => {
  it('resolves to <repo>/data/intelligence.db', () => {
    delete process.env.DB_PATH
    expect(resolveDbPath()).toBe(join(DATA_DIR, 'intelligence.db'))
    expect(relative(REPO_ROOT, resolveDbPath())).toBe(join('data', 'intelligence.db'))
  })

  /** The actual bug: the answer changed depending on who called it. */
  it('gives the same answer from any working directory', () => {
    delete process.env.DB_PATH
    const original = process.cwd()
    try {
      const seen = new Set<string>()
      for (const dir of [REPO_ROOT, join(REPO_ROOT, 'server'), join(REPO_ROOT, 'scripts')]) {
        process.chdir(dir)
        seen.add(resolveDbPath())
      }
      expect(seen.size).toBe(1)
    } finally {
      process.chdir(original)
    }
  })

  it('still lets DB_PATH win, for Docker and for in-memory tests', () => {
    process.env.DB_PATH = '/app/data/intelligence.db'
    expect(resolveDbPath()).toBe('/app/data/intelligence.db')
    process.env.DB_PATH = ':memory:'
    expect(resolveDbPath()).toBe(':memory:')
  })
})

/**
 * The resolver only holds if everyone uses it. This walks the source and fails
 * on any *other* file that names the database, which is how the second path
 * would have to be reintroduced.
 */
describe('no second database path', () => {
  /** Prose in a doc comment is not a code path; this test reads code only. */
  function code(file: string): string {
    return readFileSync(file, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  function sources(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...sources(full))
      else if (entry.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('is named only by the resolver', () => {
    const allowed = [
      join('server', 'src', 'config', 'paths.ts'),
      join('server', 'src', '__tests__', 'paths.test.ts'),
    ]
    const offenders = [join(REPO_ROOT, 'server', 'src'), join(REPO_ROOT, 'scripts')]
      .flatMap(sources)
      .filter((f) => code(f).includes('intelligence.db'))
      .map((f) => relative(REPO_ROOT, f))
      .filter((f) => !allowed.includes(f))

    expect(offenders, `import resolveDbPath() instead of building a path: ${offenders.join(', ')}`)
      .toEqual([])
  })

  it('nobody derives a data path from the working directory', () => {
    const offenders = [join(REPO_ROOT, 'server', 'src'), join(REPO_ROOT, 'scripts')]
      .flatMap(sources)
      .filter((f) => /process\.cwd\(\)/.test(code(f)))
      .map((f) => relative(REPO_ROOT, f))
      .filter((f) => f !== join('server', 'src', '__tests__', 'paths.test.ts'))

    expect(offenders, `cwd depends on who invoked the process: ${offenders.join(', ')}`)
      .toEqual([])
  })
})
