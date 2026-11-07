import { Layers, Search, ChevronRight, ChevronUp } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import {
  STAGES,
  DASHBOARD,
  type TrackedRepo,
  type Stage,
  type StageState,
  type GateResult,
  type RepoHealth,
} from '../fixtures/dashboard'

/**
 * The Tracked repositories panel.
 *
 * Rebuilds the table from `01-VERMILION-DARK.png`: a chamfered panel with a
 * title row carrying a "149 new in 19 repos" accent pill and a status legend,
 * a two-input toolbar, and the table itself — a repository column with a
 * health dot and a "N new" pill, seven stage chips, a Gate column, five
 * numeric columns and a trailing row-affordance chevron.
 *
 * SIGNATURE NOTE. The brief says "compute against the fixture's generatedAt,
 * which is passed in the data," but the agreed export signature carries only
 * `repos` and `totals`. Rather than silently widen the signature or call
 * Date.now() (explicitly forbidden), the "today" timestamp is read from
 * `DASHBOARD.generatedAt` — reading the fixture module, not editing it. If
 * the shell ever renders two panels against different snapshots this will
 * need promotion to a prop; today it does not.
 *
 * NO TanStack TABLE. The repo list is Phase 1 fixture data, five rows, no
 * sort and no virtualization. A plain <table> with semantic <th> elements
 * is smaller, keyboard-navigable without wiring, and reads as the data it
 * is. We pay for the abstraction when there is a job for it to do.
 *
 * SHAPE, NOT COLOUR. Design-QA note: seven legend entries that differ only
 * by colour would fail accessibility; the render already differentiates by
 * silhouette as well (filled dot / hollow ring / filled square / outlined
 * square / dashed ring). That is carried through below — every health dot
 * and every stage chip has its own silhouette, an aria-label naming the
 * state, and reads correctly in a monochrome snapshot.
 *
 * NUMERIC COLUMNS are `tabular-nums` and right-aligned. Dense data that
 * does not line up at the decimal is not scannable.
 *
 * DECORATIVE bits (the chevron, legend markers, stage-chip inner glyphs)
 * are className "hg-decor" and aria-hidden. The row chevron is strictly
 * visual; the whole row's affordance is carried by the repo link, which
 * keeps the browser's native focus outline.
 * FOCUS: the two inputs below deliberately carry NO `outline-none`. Tailwind's
 * utility would win over the global `:focus-visible` rule in index.css, which
 * is written with `:where()` and so has zero specificity — suppressing the ring
 * there leaves a keyboard user with no visible focus on the search field. The
 * Go app shipped exactly that defect on its stat tiles and it measured 2.08:1.
 *
 */
export function TrackedRepos({
  repos,
  totals,
}: {
  repos: TrackedRepo[]
  totals: { newCount: number; repoCount: number }
}) {
  const now = new Date(DASHBOARD.generatedAt).getTime()

  return (
    <Panel className="relative isolate">
      <PanelHeader
        icon={<Layers size={14} />}
        title="Tracked repositories"
      >
        <NewReposPill newCount={totals.newCount} repoCount={totals.repoCount} />
        <StatusLegend />
        <ChevronUp
          size={14}
          aria-hidden="true"
          className="hg-decor ml-2"
          style={{ color: 'var(--hg-text-muted)' }}
        />
      </PanelHeader>

      <Toolbar />

      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-[12px]"
          style={{ color: 'var(--hg-text)' }}
        >
          <caption className="sr-only">Repositories tracked in this workspace, their pipeline stages, gate status, and activity.</caption>
          <TableHead />
          <tbody>
            {repos.map((repo) => (
              <RepoRow key={`${repo.owner}/${repo.name}`} repo={repo} now={now} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   HEADER: "149 new in 19 repos" pill + legend
   ──────────────────────────────────────────────────────────────────────── */

function NewReposPill({ newCount, repoCount }: { newCount: number; repoCount: number }) {
  return (
    <span
      className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums"
      style={{
        background: 'var(--hg-accent-fill)',
        color: 'var(--hg-accent-ink)',
        borderColor: 'var(--hg-accent-fill)',
      }}
    >
      {newCount} new in {repoCount} repos
    </span>
  )
}

/**
 * The seven-item legend. Every marker carries its own silhouette AND its
 * own text label — colour-only distinctions would fail SC 1.4.1, and the
 * render itself already uses shape as the primary signal.
 */
function StatusLegend() {
  const items: Array<{ label: string; marker: React.ReactNode }> = [
    { label: 'active', marker: <HealthMarker health="ACTIVE" /> },
    { label: 'slowing', marker: <HealthMarker health="SLOWING" /> },
    { label: 'dormant', marker: <HealthMarker health="DORMANT" /> },
    { label: 'not checked', marker: <HealthMarker health="NOT_CHECKED" /> },
    { label: 'done', marker: <StageMarker state="done" /> },
    { label: 'current', marker: <StageMarker state="current" /> },
    { label: 'failed', marker: <StageMarker state="failed" /> },
  ]
  return (
    <ul
      className="hidden items-center gap-3 text-[11px] md:flex"
      style={{ color: 'var(--hg-text-muted)' }}
      aria-label="Row status legend"
    >
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          {item.marker}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   TOOLBAR: search + add-a-repo + Track
   ──────────────────────────────────────────────────────────────────────── */

function Toolbar() {
  return (
    <div
      className="flex items-center gap-3 border-b px-4 py-2.5"
      style={{ borderColor: 'var(--hg-line)' }}
    >
      <label className="relative flex min-w-0 flex-1 items-center">
        <span className="sr-only">Search repositories</span>
        <Search
          size={14}
          aria-hidden="true"
          className="hg-decor pointer-events-none absolute left-2.5"
          style={{ color: 'var(--hg-text-muted)' }}
        />
        <input
          type="search"
          placeholder="Search repositories"
          className="w-full border py-1.5 pl-8 pr-3 text-[12px]"
          style={{
            background: 'var(--hg-surface-sunken)',
            borderColor: 'var(--hg-line)',
            color: 'var(--hg-text)',
          }}
        />
      </label>

      {/*
        min-w-0 on the label, and a max rather than a fixed width on the
        input. It was `w-[300px]`, which with the Track button and the gap
        came to 366px and could not fit a 375px phone — `<main>` ran 21px
        wider than its container and `overflow-x-hidden` clipped the Track
        button off the right edge. The document reported no overflow at all,
        which is why every 390px gate stayed green over it.
      */}
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center">
          <span className="sr-only">Add a repository by owner/name or GitHub link</span>
          <input
            type="text"
            placeholder="Add a repo: owner/name or GitHub link"
            className="w-full max-w-[300px] border py-1.5 px-3 text-[12px]"
            style={{
              background: 'var(--hg-surface-sunken)',
              borderColor: 'var(--hg-line)',
              color: 'var(--hg-text)',
            }}
          />
        </label>
        <button
          type="button"
          className="border px-3 py-1.5 text-[12px] font-medium"
          style={{
            background: 'var(--hg-accent-fill)',
            borderColor: 'var(--hg-accent-fill)',
            color: 'var(--hg-accent-ink)',
          }}
        >
          Track
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   TABLE
   ──────────────────────────────────────────────────────────────────────── */

const COL_HEAD_STYLE = {
  color: 'var(--hg-text-muted)',
  borderColor: 'var(--hg-line)',
} as const

function TableHead() {
  return (
    <thead>
      <tr
        className="border-b text-[11px] font-medium tracking-wide"
        style={COL_HEAD_STYLE}
      >
        <th scope="col" className="px-4 py-2 text-left">Repository</th>
        {STAGES.map((s) => (
          <th
            key={s}
            scope="col"
            className="px-1 py-2 text-center font-medium"
            style={{ width: '32px' }}
          >
            {s}
          </th>
        ))}
        <th scope="col" className="px-2 py-2 text-left">Gate</th>
        <th scope="col" className="px-3 py-2 text-right">Open</th>
        <th scope="col" className="px-3 py-2 text-right">Good<br />first</th>
        <th scope="col" className="px-3 py-2 text-right">Unassigned</th>
        <th scope="col" className="px-3 py-2 text-right">Last commit</th>
        <th scope="col" className="px-3 py-2 text-right">Watching</th>
        <th scope="col" className="px-3 py-2 text-right">Turned<br />down</th>
        <th scope="col" className="px-2 py-2" aria-label="Row actions"></th>
      </tr>
    </thead>
  )
}

const NUM_CELL = 'px-3 py-2 text-right font-mono tabular-nums'

function RepoRow({ repo, now }: { repo: TrackedRepo; now: number }) {
  const slug = `${repo.owner}/${repo.name}`
  const daysSinceCommit = Math.max(
    0,
    Math.floor((now - new Date(repo.lastCommit).getTime()) / 86_400_000),
  )

  return (
    <tr
      className="border-b"
      style={{ borderColor: 'var(--hg-line)' }}
    >
      <th scope="row" className="px-4 py-2 text-left font-normal">
        <span className="inline-flex items-center gap-2.5">
          <HealthMarker health={repo.health} />
          <a
            href={`https://github.com/${slug}`}
            className="font-mono text-[12px] underline-offset-2 hover:underline"
            style={{ color: 'var(--hg-text)' }}
          >
            {slug}
          </a>
          {repo.newCount > 0 && (
            <span
              className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
              style={{
                background: 'var(--hg-surface-sunken)',
                borderColor: 'var(--hg-accent)',
                color: 'var(--hg-accent)',
              }}
              aria-label={`${repo.newCount} new since last visit`}
            >
              {repo.newCount} new
            </span>
          )}
        </span>
      </th>

      {repo.stages.map((state, i) => (
        <td key={STAGES[i]} className="px-1 py-2 text-center align-middle">
          <StageChip stage={STAGES[i]} state={state} />
        </td>
      ))}

      <td className="px-2 py-2 text-left">
        <GateCell gate={repo.gate} />
      </td>
      <td className={NUM_CELL}>{repo.openIssuesTotal.toLocaleString('en-US')}</td>
      <td className={NUM_CELL}>{repo.openIssuesGoodFirst.toLocaleString('en-US')}</td>
      <td className={NUM_CELL}>{repo.openIssuesUnassigned.toLocaleString('en-US')}</td>
      <td className={NUM_CELL}>
        <LastCommitCell days={daysSinceCommit} />
      </td>
      <td className={NUM_CELL}>{repo.watching.toLocaleString('en-US')}</td>
      <td className={NUM_CELL}>{repo.turnedDown.toLocaleString('en-US')}</td>
      <td className="px-2 py-2 text-right">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="hg-decor inline-block"
          style={{ color: 'var(--hg-text-muted)' }}
        />
      </td>
    </tr>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   MARKERS — each distinguished by SHAPE as well as colour.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Health dot. Four states, four silhouettes so a monochrome snapshot still
 * tells them apart:
 *   ACTIVE       filled circle     green
 *   SLOWING      hollow ring       accent
 *   DORMANT      filled square     muted
 *   NOT_CHECKED  dashed ring       muted
 */
function HealthMarker({ health }: { health: RepoHealth }) {
  const base = {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    verticalAlign: 'middle',
    boxSizing: 'border-box' as const,
  }
  switch (health) {
    case 'ACTIVE':
      return (
        <span
          role="img"
          aria-label="active"
          style={{ ...base, background: 'var(--hg-success)', borderRadius: '50%' }}
        />
      )
    case 'SLOWING':
      return (
        <span
          role="img"
          aria-label="slowing"
          style={{
            ...base,
            background: 'transparent',
            border: '2px solid var(--hg-accent)',
            borderRadius: '50%',
          }}
        />
      )
    case 'DORMANT':
      return (
        <span
          role="img"
          aria-label="dormant"
          style={{ ...base, background: 'var(--hg-text-muted)' }}
        />
      )
    case 'NOT_CHECKED':
      return (
        <span
          role="img"
          aria-label="not checked"
          style={{
            ...base,
            background: 'transparent',
            border: '2px dashed var(--hg-text-muted)',
            borderRadius: '50%',
          }}
        />
      )
  }
}

/**
 * Stage chip. Four states, each with its own silhouette AND inner glyph:
 *   todo     outlined, no fill       — no inner mark (the Go side's name)
 *   done     filled muted            — inner horizontal bar (filled plateau)
 *   current  filled accent           — inner caret (▸ the active one)
 *   failed   filled danger           — inner cross
 *
 * The chip is a tiny 22×10 button-shaped rectangle; the inner glyph is drawn
 * as a sibling span so it tints with the chip without needing an SVG.
 */
function StageChip({ stage, state }: { stage: Stage; state: StageState }) {
  const label = `${stage} ${STATE_WORD[state]}`
  const boxBase = {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: '22px',
    height: '10px',
    boxSizing: 'border-box' as const,
    borderRadius: '2px',
  }
  switch (state) {
    case 'todo':
      return (
        <span
          role="img"
          aria-label={label}
          title={label}
          style={{
            ...boxBase,
            background: 'transparent',
            border: '1px solid var(--hg-line-strong)',
          }}
        />
      )
    case 'done':
      return (
        <span
          role="img"
          aria-label={label}
          title={label}
          style={{
            ...boxBase,
            background: 'var(--hg-text-muted)',
            border: '1px solid var(--hg-text-muted)',
          }}
        >
          <span
            aria-hidden="true"
            className="hg-decor"
            style={{
              width: '10px',
              height: '2px',
              background: 'var(--hg-surface)',
              borderRadius: '1px',
            }}
          />
        </span>
      )
    case 'current':
      return (
        <span
          role="img"
          aria-label={label}
          title={label}
          style={{
            ...boxBase,
            background: 'var(--hg-accent-fill)',
            border: '1px solid var(--hg-accent-fill)',
          }}
        >
          <span
            aria-hidden="true"
            className="hg-decor font-mono text-[9px] leading-none"
            style={{ color: 'var(--hg-accent-ink)' }}
          >
            ▸
          </span>
        </span>
      )
    case 'failed':
      return (
        <span
          role="img"
          aria-label={label}
          title={label}
          style={{
            ...boxBase,
            background: 'var(--hg-danger)',
            border: '1px solid var(--hg-danger)',
          }}
        >
          <span
            aria-hidden="true"
            className="hg-decor font-mono text-[10px] leading-none font-bold"
            style={{ color: 'var(--hg-surface)' }}
          >
            ×
          </span>
        </span>
      )
  }
}

/**
 * Standalone legend marker that mirrors a StageChip in the header legend.
 * Reuses StageChip directly so the legend cannot drift from the row chips
 * it describes.
 */
function StageMarker({ state }: { state: StageState }) {
  return <StageChip stage={'RCN' as Stage} state={state} />
}

const STATE_WORD: Record<StageState, string> = {
  todo: 'not started',
  done: 'done',
  current: 'in progress',
  failed: 'failed',
}

/**
 * Gate cell. "PASS" renders in `--hg-success`; FAIL in `--hg-danger`; NONE
 * renders as a figure dash so the column stays aligned.
 */
function GateCell({ gate }: { gate: GateResult }) {
  if (gate === 'PASS') {
    return (
      <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--hg-success)' }}>
        PASS
      </span>
    )
  }
  if (gate === 'FAIL') {
    return (
      <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--hg-danger)' }}>
        FAIL
      </span>
    )
  }
  return (
    <span aria-label="no gate" style={{ color: 'var(--hg-text-muted)' }}>
      —
    </span>
  )
}

/**
 * Last commit cell. The render pairs the day count with a small horizontal
 * track whose fill scales with freshness (shorter = fresher), so a cold
 * repo reads at a glance without reading the number. The bar is decorative;
 * the number carries the actual value for screen readers.
 */
function LastCommitCell({ days }: { days: number }) {
  /*
    An unknown age renders as an em dash, not as "NaN d" and not as "0 d".

    This surfaced the moment real data arrived: the server reports
    `ageKnown: false` for a repository it could not reach, the adapter
    correctly refuses to invent a commit date for it, and this cell then
    computed a relative age from nothing. "NaN d" is at least visibly broken —
    the worse outcome was the one lurking behind it, where defaulting to 0
    would have shown an unreachable repository as committed today.
  */
  if (!Number.isFinite(days)) {
    return (
      <span className="inline-flex items-center justify-end gap-2">
        <span title="No commit date — this repository could not be read">—</span>
      </span>
    )
  }
  // Fresh = 100%, dropping to zero at 14+ days. Decorative, no semantic floor.
  const freshness = Math.max(0, Math.min(1, 1 - days / 14))
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span
        aria-hidden="true"
        className="hg-decor hidden h-[6px] w-[48px] md:inline-block"
        style={{
          background: 'var(--hg-surface-sunken)',
          border: '1px solid var(--hg-line)',
        }}
      >
        <span
          className="block h-full"
          style={{
            width: `${freshness * 100}%`,
            background: 'var(--hg-text-muted)',
          }}
        />
      </span>
      <span>{days} d</span>
    </span>
  )
}
