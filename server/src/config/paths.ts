/**
 * Canonical on-disk locations for mutable state.
 *
 * Resolved from `__dirname`, never from `process.cwd()`. The server runs with
 * cwd = server/ while the harnesses in scripts/ are invoked from wherever the
 * operator happens to be, and resolving against cwd is exactly what let the two
 * drift apart: the server wrote server/intelligence.db while every offline
 * script read a separate, days-stale copy at the repo root and reported its
 * numbers as if they were live.
 *
 * `data/` is the directory the container already treats as state — compose
 * mounts a volume at /app/data and config.json lives there too — so local and
 * containerised layouts now agree, and DB_PATH goes back to being an override
 * rather than the only way to get the path right.
 */
import { join } from 'path'

/** Repo root, from server/src/config (tsx) or server/dist/config (built). */
const ROOT = join(__dirname, '../../..')

export const DATA_DIR = join(ROOT, 'data')

/** The one database. DB_PATH still wins, for Docker and for `:memory:` tests. */
export function resolveDbPath(): string {
  return process.env.DB_PATH ?? join(DATA_DIR, 'intelligence.db')
}
