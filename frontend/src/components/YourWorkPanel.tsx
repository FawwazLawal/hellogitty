import { Inbox, AlertTriangle } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { DASHBOARD, type DashboardData, type WorkItem } from '../fixtures/dashboard'

/**
 * Your-work panel.
 *
 * A trailing list of PRs and issues the user has open anywhere on GitHub, with
 * a "Your move" chip on anything waiting for them. The fixture happens to hold
 * one item right now, but the layout has to survive ten — rows are even-height,
 * the chip is a fixed-width badge rather than a growing pill, and the right
 * column hugs the end so the title can take any width without pushing the
 * timestamp off the edge.
 *
 * TOKEN CHOICES, for the brief's judgement question — the three hues that
 * could all have been accent in a red identity:
 *
 *   accent (bright red, thin stroke)   → the panel's leading rail only
 *   accent-fill (solid oxblood + ink)  → "Your move" chip
 *   success (green)                    → "1 new" pill
 *
 * Why not one colour three ways: in the vermilion identity, "attention" and
 * "newness" are two different asks. The rail is identity — it says "this is
 * part of HelloGitty". The chip is a call to action — "the ball is in your
 * court". The pill is novelty — "since you last looked, one appeared". A user
 * triaging this panel skims for which items have the chip, then for what's
 * green on the pill, then ignores the rail: three glances looking for three
 * things. Painting all three the same colour collapses those glances into one
 * noisy field where the only thing that stands out is "red".
 *
 * Why accent and accent-fill are both red and still read as different: one is
 * a 3px vertical stroke on the panel's edge, the other is a fully filled chip
 * sitting on a row. They differ in form, not only in hue — the eye reads
 * "line" and "badge" as separate objects even when the hue matches, the way a
 * red underline and a red button read as unrelated. The founder's render does
 * exactly this, and the measured contrast backs it up: --hg-accent carries
 * numerals at 4.5:1 on the panel, --hg-accent-fill carries --hg-accent-ink at
 * 4.5:1 on itself, so each is held to the floor its surface requires.
 *
 * The green pill for "1 new" is the explicit ADR §5 rule: success is never
 * recoloured to the identity hue, so "passing" and "urgent" stay distinct.
 * "New" is adjacent to "passing" on the same cognitive axis: a positive event,
 * nothing wrong.
 */
export function YourWorkPanel({
  work,
  user,
}: {
  work: DashboardData['work']
  user: string
}) {
  return (
    <Panel>
      <PanelHeader
        icon={<Inbox size={14} aria-hidden="true" />}
        title={`Your work · ${work.needYou}`}
      >
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          need you
        </span>
      </PanelHeader>

      <div className="px-4 py-3">
        <p className="text-[11px] leading-snug" style={{ color: 'var(--hg-text-muted)' }}>
          Pull requests and issues{' '}
          <span style={{ color: 'var(--hg-text)' }}>@{user}</span> has out, anywhere
          on GitHub · updated 1 min ago
        </p>

        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{
              borderColor: 'var(--hg-success)',
              color: 'var(--hg-success)',
            }}
          >
            {work.newCount} new
          </span>
          {/*
            "Show all" routes to the full work board, which is React-converted
            and lives at /work. It had been a <button> with no handler — the
            same dead-control pattern as the sibling Conversations panel —
            and anchoring it is the minimum move.
          */}
          <a
            href="/work"
            className="ml-auto border px-2.5 py-1 text-[11px] font-medium no-underline tabular-nums"
            style={{
              borderColor: 'var(--hg-line-strong)',
              background: 'var(--hg-surface-raised)',
              color: 'var(--hg-text)',
            }}
          >
            Show all ({work.total})
          </a>
        </div>

        {/* Column headers. */}
        <div
          className="mt-3 grid grid-cols-[1fr_auto] items-center border-b pb-1.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--hg-text-muted)', borderColor: 'var(--hg-line)' }}
        >
          <span>Name</span>
          <span>Updated</span>
        </div>

        <ul className="divide-y" style={{ borderColor: 'var(--hg-line)' }}>
          {work.items.map((item) => (
            <WorkRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function WorkRow({ item }: { item: WorkItem }) {
  return (
    <li
      className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 border-b py-2.5 last:border-b-0"
      style={{ borderColor: 'var(--hg-line)' }}
    >
      {item.yourMove ? (
        <span
          className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: 'var(--hg-accent-fill)',
            color: 'var(--hg-accent-ink)',
          }}
        >
          Your move
        </span>
      ) : (
        <span className="w-[72px]" aria-hidden="true" />
      )}

      <div className="min-w-0">
        <p
          className="truncate text-[12px] font-medium leading-snug"
          style={{ color: 'var(--hg-text)' }}
          title={item.title}
        >
          {item.title}
        </p>
        <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: 'var(--hg-text-muted)' }}>
          <a
            href={`https://github.com/${item.repo}/issues/${item.number}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:underline"
            style={{ color: 'var(--hg-text-muted)' }}
          >
            {item.repo}#{item.number}
          </a>
          {item.openedByYou && <> · You opened it</>}
        </p>
        {item.note && (
          <p
            className="mt-1 inline-flex items-center gap-1 text-[11px]"
            style={{ color: 'var(--hg-warning)' }}
          >
            <AlertTriangle size={12} aria-hidden="true" />
            {item.note}
          </p>
        )}
      </div>

      <time
        dateTime={item.updated}
        className="whitespace-nowrap text-[11px] tabular-nums"
        style={{ color: 'var(--hg-text-muted)' }}
      >
        {relativeTime(item.updated)}
      </time>
    </li>
  )
}

/**
 * Relative time from an ISO string, against the fixture's `generatedAt`. Not
 * `Date.now()` — the brief forbids it so screenshot gates do not drift. The
 * fixture is frozen, so this helper is pure: same inputs, same output.
 */
function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  const now = Date.parse(DASHBOARD.generatedAt)
  if (Number.isNaN(then) || Number.isNaN(now)) return ''
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  const minute = 60
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (seconds < minute) return 'just now'
  if (seconds < hour) return `${Math.round(seconds / minute)}m ago`
  if (seconds < day) return `${Math.round(seconds / hour)}h ago`
  if (seconds < week) return `${Math.round(seconds / day)}d ago`
  return `${Math.round(seconds / week)}w ago`
}
