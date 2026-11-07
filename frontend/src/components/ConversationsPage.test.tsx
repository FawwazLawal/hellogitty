import { describe, it, expect } from 'vitest'
import { __orderedRows as orderedRows } from './ConversationsPage'

/**
 * The sort rule for /conversations, pinned in a unit test.
 *
 * Why not leave this to the e2e spec: the rule it enforces — "unknown values
 * sort LAST, not first" — is the exact kind of defect a visual regression
 * misses. A list where every row renders correctly and the order is quietly
 * wrong looks fine in a screenshot; the signal is only visible if you already
 * know what the right order is. A unit test states the rule directly, so a
 * regression fails on the sentence rather than on the picture.
 */

const base = {
  key: 'k',
  kind: 'Issue',
  title: 't',
  url: 'https://example.com',
  why: '',
  ago: 'now',
  agoTitle: '2026-11-06',
  attn: '',
}

function row(over: Partial<typeof base> & { repo: string; number: number; sinceUnix: number }) {
  return { ...base, ...over }
}

describe('orderedRows (sort rule)', () => {
  it('"updated desc" puts unknown (sinceUnix=0) LAST, not first', () => {
    // A row the server never got a timestamp for sits at the bottom of the
    // list even when direction is descending — the opposite of what a naive
    // numeric sort would do, where 0 compares as the smallest value and
    // therefore the top of a descending sort. This is the "unknown is not
    // zero" rule applied to ordering: a thing we know least about is not
    // the thing most worth looking at.
    const rows = orderedRows(
      [
        row({ repo: 'acme/rocket', number: 1, sinceUnix: 1700000000 }), // older known
        row({ repo: 'acme/rocket', number: 2, sinceUnix: 0 }),          // unknown
        row({ repo: 'acme/rocket', number: 3, sinceUnix: 1800000000 }), // newer known
      ],
      [],
      'all',
      '',
      'updated',
      'desc',
    )
    expect(rows.map((r) => r.number)).toEqual([3, 1, 2])
  })

  it('"updated asc" still puts unknown (sinceUnix=0) LAST — unknown is not a time', () => {
    const rows = orderedRows(
      [
        row({ repo: 'acme/rocket', number: 1, sinceUnix: 1700000000 }),
        row({ repo: 'acme/rocket', number: 2, sinceUnix: 0 }),
        row({ repo: 'acme/rocket', number: 3, sinceUnix: 1800000000 }),
      ],
      [],
      'all',
      '',
      'updated',
      'asc',
    )
    expect(rows.map((r) => r.number)).toEqual([1, 3, 2])
  })

  it('"status" puts needs-reply before waiting, ties break by newest first', () => {
    const rows = orderedRows(
      [row({ repo: 'a/b', number: 11, sinceUnix: 1000 })],
      [
        row({ repo: 'a/b', number: 21, sinceUnix: 2000 }),
        row({ repo: 'a/b', number: 22, sinceUnix: 3000 }),
      ],
      'all',
      '',
      'status',
      'asc',
    )
    expect(rows.map((r) => `${r.group}-${r.number}`)).toEqual(['you-11', 'them-22', 'them-21'])
  })

  it('filter "you" hides the waiting group; search filters by hay', () => {
    const rows = orderedRows(
      [row({ repo: 'a/b', number: 11, title: 'parser crash', sinceUnix: 1000 })],
      [row({ repo: 'a/b', number: 22, title: 'metrics tweak', sinceUnix: 2000 })],
      'you',
      'parser',
      'status',
      'asc',
    )
    expect(rows.map((r) => r.number)).toEqual([11])

    const all = orderedRows(
      [row({ repo: 'a/b', number: 11, title: 'parser crash', sinceUnix: 1000 })],
      [row({ repo: 'a/b', number: 22, title: 'metrics tweak', sinceUnix: 2000 })],
      'all',
      'metrics',
      'status',
      'asc',
    )
    expect(all.map((r) => r.number)).toEqual([22])
  })
})
