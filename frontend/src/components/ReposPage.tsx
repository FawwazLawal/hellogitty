import { useMemo, useState } from 'react'
import { Calendar, AlertTriangle, ExternalLink } from 'lucide-react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { usePageTitle } from '../hooks/usePageTitle'
import { Panel, PanelHeader } from './chrome/Chrome'
import { useDashboard, type RepoFromApi } from '../data/dashboard'

/**
 * The tracked-repositories page.
 *
 * NO NEW ENDPOINT, AGAIN: `/app/api/dashboard.json` already carries every
 * tracked repository — all 80 of them, not a panel's worth — with health,
 * counts, stage and age. The dashboard's own repo table reads the same
 * document, so the two cannot disagree about what is tracked.
 *
 * Search, health filter and sort stay CLIENT-SIDE, as they are in the
 * templated page. Every row is already here; sending a query to the server to
 * re-filter a list the browser is holding would add a round trip, a loading
 * state and a way for the two to drift, to do less.
 */

type Health = 'ACTIVE' | 'SLOW' | 'DORMANT' | 'UNKNOWN'
type Sort = 'name' | 'open' | 'gfi' | 'commit'

const HEALTH_LABEL: Record<Health, string> = {
  ACTIVE: 'Active',
  SLOW: 'Slowing',
  DORMANT: 'Dormant',
  UNKNOWN: 'Not checked',
}

/**
 * The health dot's colour.
 *
 * UNKNOWN is a dashed outline, not a filled dot in some neutral colour,
 * because every filled dot on this page means "we looked, and this is what we
 * found". A grey dot would read as a fourth health state rather than as the
 * absence of one — the same mistake as rendering an unfetched count as 0.
 */
function HealthDot({ health }: { health: Health }) {
  const common = 'inline-block h-[10px] w-[10px] shrink-0 rounded-full'
  if (health === 'UNKNOWN') {
    return <span className={common} style={{ border: '1.5px dashed var(--hg-text-muted)' }} aria-hidden="true" />
  }
  const fill =
    health === 'ACTIVE' ? 'var(--hg-success)' : health === 'DORMANT' ? 'var(--hg-warning)' : 'transparent'
  const ring = health === 'SLOW' ? '2px solid var(--hg-warning)' : undefined
  return <span className={common} style={{ background: fill, border: ring }} aria-hidden="true" />
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'stage' }) {
  const color =
    tone === 'ok' ? 'var(--hg-success)' : tone === 'warn' ? 'var(--hg-warning)' : 'var(--hg-text-muted)'
  return (
    <span
      className="whitespace-nowrap border px-2 py-px text-[11px]"
      style={{
        color: tone === 'stage' ? 'var(--hg-text)' : color,
        borderColor: tone && tone !== 'stage' ? color : 'var(--hg-line)',
        background: tone === 'stage' ? 'var(--hg-surface-raised)' : undefined,
      }}
    >
      {children}
    </span>
  )
}

function RepoCard({ repo, animate }: { repo: RepoFromApi; animate: boolean }) {
  const health = (repo.health || 'UNKNOWN') as Health
  const stats: { n: number; label: string; href: string }[] = [
    { n: repo.open, label: 'Open', href: `${repo.url}/issues` },
    {
      n: repo.goodFirst,
      label: 'Good first',
      href: `${repo.url}/issues?q=is%3Aopen+label%3A%22good+first+issue%22`,
    },
    { n: repo.unassigned, label: 'Unassigned', href: `${repo.url}/issues?q=is%3Aopen+no%3Aassignee` },
  ]

  /*
    The `layout` prop is the whole reason motion is here: when the user picks
    a different sort, the browser cannot animate the resulting DOM reorder,
    because the layout change happens discretely. motion measures each card's
    position before and after the change and tweens between them (FLIP). With
    `prefers-reduced-motion: reduce`, we render a plain <li> and skip the
    layout machinery entirely — not a shorter duration, which is still motion.
  */
  if (!animate) {
    return (
      <li className="border" style={{ borderColor: 'var(--hg-line)', background: 'var(--hg-surface)' }}>
        {renderCardBody(repo, health, stats)}
      </li>
    )
  }
  return (
    <motion.li
      layout="position"
      transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
      className="border"
      style={{ borderColor: 'var(--hg-line)', background: 'var(--hg-surface)' }}
    >
      {renderCardBody(repo, health, stats)}
    </motion.li>
  )
}

function renderCardBody(
  repo: RepoFromApi,
  health: Health,
  stats: { n: number; label: string; href: string }[],
) {
  return (
    <>
      <div
        className="flex items-center gap-2.5 border-b border-l-[3px] px-3.5 py-2.5"
        style={{
          borderColor: 'var(--hg-line)',
          borderLeftColor: 'var(--hg-accent)',
          background: 'var(--hg-surface-raised)',
        }}
      >
        <HealthDot health={health} />
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] font-semibold no-underline hover:underline"
          style={{ color: 'var(--hg-text)' }}
        >
          <span className="truncate">
            <span style={{ color: 'var(--hg-text-muted)', fontWeight: 400 }}>{repo.owner}/</span>
            {repo.name}
          </span>
          <ExternalLink size={11} aria-hidden="true" className="shrink-0 opacity-50" />
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2 px-3.5 py-2.5">
        {stats.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            className="block text-center no-underline hover:underline"
            style={{ color: 'var(--hg-text)' }}
          >
            {/*
              AN UNPOLLED REPOSITORY HAS NO COUNTS, it has three zeros that
              mean "nobody has looked". Printing them as 0 says this
              repository needs nothing from you — the most reassuring possible
              reading of the one state where nothing is known. The templated
              page printed them; this one prints an em dash and says why in
              the tag below.

              The link stays live: the count is unknown, but the GitHub search
              behind it is still exactly where you would go to find out.
            */}
            <span
              className="block font-mono text-[17px] font-semibold tabular-nums"
              style={{ color: repo.polled && s.n ? 'var(--hg-text)' : 'var(--hg-text-muted)' }}
            >
              {repo.polled ? s.n : '\u2014'}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
              {s.label}
            </span>
          </a>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 px-3.5 pb-2.5">
        <Tag tone={health === 'ACTIVE' ? 'ok' : health === 'UNKNOWN' ? undefined : 'warn'}>
          {HEALTH_LABEL[health].toLowerCase()}
        </Tag>
        {/*
          The age tag appears ONLY when the age is known. An unknown age
          rendered as "0d since commit" would read as a commit today — the
          most flattering possible reading of "we have never looked".
        */}
        {repo.ageKnown && <Tag>{repo.ageDays}d since commit</Tag>}
        {repo.inPipeline && repo.stage && <Tag tone="stage">{repo.stage}</Tag>}
        {repo.turnedDown > 0 && <Tag>{repo.turnedDown} turned down</Tag>}
      </div>

      {repo.error && (
        <p
          className="border-t px-3.5 py-2 text-[11px]"
          style={{ borderColor: 'var(--hg-line)', color: 'var(--hg-danger)' }}
        >
          {repo.error}
        </p>
      )}
    </>
  )
}

export function ReposPage() {
  usePageTitle('Tracked repositories · HelloGitty')
  const q = useDashboard()
  const [search, setSearch] = useState('')
  const [health, setHealth] = useState<'' | Health>('')
  const [sort, setSort] = useState<Sort>('name')
  // ADR-UI-002 §8: motion respects `prefers-reduced-motion` as a P0. `null`
  // (the initial SSR-safe value before the media query reads) is treated as
  // "unknown but assume allowed"; the first paint is static either way.
  const reduce = useReducedMotion()
  const animate = reduce !== true

  const all = q.data?.repos ?? []

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    const filtered = all.filter((r) => {
      const full = `${r.owner}/${r.name}`.toLowerCase()
      if (!words.every((w) => full.includes(w))) return false
      if (health && (r.health || 'UNKNOWN') !== health) return false
      return true
    })
    const by = [...filtered]
    by.sort((a, b) => {
      switch (sort) {
        /*
          Unpolled repositories have no count to sort by, so they go last in
          both count sorts rather than tying with a genuine zero. Descending
          order already buries a real 0 at the bottom; an unknown belongs
          below it, not mixed in with repositories we have actually checked
          and found empty.
        */
        case 'open':
          if (a.polled !== b.polled) return a.polled ? -1 : 1
          return b.open - a.open
        case 'gfi':
          if (a.polled !== b.polled) return a.polled ? -1 : 1
          return b.goodFirst - a.goodFirst
        case 'commit':
          /*
            UNKNOWN AGES SORT LAST, never first.

            "Most recent commit" ascending on age would put every repository
            we have never checked at the very top, as though they had all been
            committed to seconds ago. The templated page handles this by
            substituting 100000 days; doing it as an explicit comparison says
            why, and cannot be mistaken for a real age if it ever reaches a
            tooltip.
          */
          if (a.ageKnown !== b.ageKnown) return a.ageKnown ? -1 : 1
          if (!a.ageKnown) return 0
          return a.ageDays - b.ageDays
        default:
          return `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`)
      }
    })
    return by
  }, [all, search, health, sort])

  const selectStyle = {
    background: 'var(--hg-surface-sunken)',
    borderColor: 'var(--hg-line)',
    color: 'var(--hg-text)',
  }

  return (
    <main className="min-w-0 overflow-x-hidden px-4 pb-24 pt-4">
      <h1 className="mb-1 text-[17px] font-bold" style={{ color: 'var(--hg-text)' }}>
        Tracked repositories
      </h1>
      <p className="mb-3 text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
        All repositories HelloGitty tracks, with health, issue counts and pipeline stage.
      </p>

      {q.isError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      <Panel>
        <PanelHeader icon={<Calendar size={14} aria-hidden="true" />} title="Repositories">
          <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
            {/*
              "n of m", not just a count — with a filter on, a bare number
              cannot be told from the total, and the reader has no way to see
              that the list is narrower than it looks.
            */}
            {q.isSuccess ? `${shown.length} of ${all.length}` : '—'}
          </span>
        </PanelHeader>

        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--hg-line)' }}
        >
          <label className="flex min-w-[200px] flex-1 items-center">
            <span className="sr-only">Search tracked repositories</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search repositories"
              className="w-full border px-3 py-1.5 text-[12px]"
              style={selectStyle}
            />
          </label>
          <label className="flex items-center">
            <span className="sr-only">Filter by health</span>
            <select
              value={health}
              onChange={(e) => setHealth(e.target.value as '' | Health)}
              className="border px-2.5 py-1.5 text-[12px]"
              style={selectStyle}
            >
              <option value="">All health</option>
              {(Object.keys(HEALTH_LABEL) as Health[]).map((h) => (
                <option key={h} value={h}>
                  {HEALTH_LABEL[h]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center">
            <span className="sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="border px-2.5 py-1.5 text-[12px]"
              style={selectStyle}
            >
              <option value="name">Name</option>
              <option value="open">Most open issues</option>
              <option value="gfi">Most good first issues</option>
              <option value="commit">Most recent commit</option>
            </select>
          </label>
        </div>

        {q.isSuccess && all.length === 0 && (
          <p className="px-4 py-10 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            No repositories tracked yet.
          </p>
        )}
        {q.isSuccess && all.length > 0 && shown.length === 0 && (
          <p className="px-4 py-10 text-center text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            No tracked repository matches those filters.
          </p>
        )}

        {/*
          `LayoutGroup` coordinates the FLIP animation across sibling cards on
          a sort change — when the user picks a different sort each card
          measures its old and new position and tweens between them. The
          `useReducedMotion` hook returns the OS setting; when true, every
          card falls through to its plain <li> branch and no measurement runs.
        */}
        <LayoutGroup>
          <ul className="grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {shown.map((r) => (
              <RepoCard key={`${r.owner}/${r.name}`} repo={r} animate={animate} />
            ))}
          </ul>
        </LayoutGroup>
      </Panel>
    </main>
  )
}
