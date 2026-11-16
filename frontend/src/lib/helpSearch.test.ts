import { describe, expect, it } from 'vitest'
import { buildChunks, rank, stem, words } from './helpSearch'
import type { HelpDoc } from '../data/help'

/**
 * The regression this port was opened to close (issue #293): typing
 * "adding repos" into help search used to return "Nothing matches"
 * because the substring filter never collapsed "adding" to "add" or
 * "repos" to "repo". The templated page did, through the ranker ported
 * in `helpSearch.ts`.
 *
 * These tests prove the pieces that stand up that end-to-end claim:
 * the stemmer, the tokenizer, the alternatives table and the chunk
 * walk. They don't try to re-prove every subtlety of the scoring
 * formula — the ordering of scores is tuned, the goal is that "adding
 * repos" finds real answers, in the right order, instead of nothing.
 */

// A minimal HelpDoc shaped like the real one. The HTML here
// deliberately matches what the server emits: an h2 for the section,
// plain <p> paragraphs, a <ul><li> list. The chunker walks these.
function mockDoc(): HelpDoc {
  return {
    title: 'HelloGitty help',
    intro: '<p>Intro</p>',
    introText: 'Intro',
    sections: [
      {
        id: 'adding',
        title: 'Adding repositories',
        text: 'Follow a repository to start tracking it.',
        html: `
          <p>To <strong>add</strong> a repository, open the picker and pick one from your list.</p>
          <p>You can also follow a project by pasting its URL.</p>
          <ul>
            <li>Owners and collaborators show first in the picker.</li>
            <li>Starred projects come next.</li>
          </ul>
        `,
      },
      {
        id: 'alerts',
        title: 'Alerts',
        text: 'Alerts tell you when something changed.',
        html: `<p>Alerts tell you when a repository went dormant or a check failed.</p>`,
      },
    ],
    glossary: [
      {
        id: 'repository',
        label: 'Repository',
        kind: 'noun',
        means: 'A GitHub repository you are following.',
        do: 'Add one from the picker; remove one by untracking.',
        search: 'repository repo project',
      },
      {
        id: 'follow',
        label: 'Follow',
        kind: 'verb',
        means: 'Start tracking a repository so it appears on the dashboard.',
        search: 'follow add track',
      },
      {
        id: 'alert',
        label: 'Alert',
        kind: 'noun',
        means: 'A signal that something changed on a tracked repo.',
        search: 'alert',
      },
    ],
    about: [],
    aiPrompt: 'prompt',
  }
}

describe('stem', () => {
  it('collapses the forms the regression depends on', () => {
    // These are the ones that have to work: a reader types "adding
    // repos" and expects "add" and "repo" to match. Each rule below
    // is a line in the stemmer; the assertion is per-rule.
    expect(stem('adding')).toBe('add')
    expect(stem('repos')).toBe('repo')
    expect(stem('repositories')).toBe('repository')
    expect(stem('watches')).toBe('watch')
    expect(stem('dismissed')).toBe('dismiss')
  })

  it('leaves short words alone so stop words survive', () => {
    expect(stem('is')).toBe('is')
    expect(stem('as')).toBe('as')
    expect(stem('its')).toBe('its')
  })
})

describe('words', () => {
  it('drops stop words and stems the rest', () => {
    expect(words('How do I add a repository?')).toEqual(['add', 'repository'])
    expect(words('adding repos')).toEqual(['add', 'repo'])
  })
})

describe('rank — the issue #293 reproduction', () => {
  it('returns hits for "adding repos" where substring found nothing', () => {
    // The original defect, framed as a test. Before this port, the
    // substring filter returned zero matches for this query because
    // the text says "add a repository" and the query says "adding
    // repos". After the port, the stemmer collapses both to the same
    // tokens and the ALT table equates "repo" with "repository".
    const chunks = buildChunks(mockDoc())
    const r = rank('adding repos', chunks)
    expect(r.hits.length).toBeGreaterThan(0)
    // Every surviving hit must actually touch both ideas (add/follow,
    // repo/repository/project) — the covered === best rule in rank().
    for (const h of r.hits) {
      expect(h.covered).toBe(2)
    }
  })

  it('finds the glossary term "Repository" through its label', () => {
    const chunks = buildChunks(mockDoc())
    const r = rank('repo', chunks)
    expect(r.hits.length).toBeGreaterThan(0)
    const linked = r.hits.map((h) => h.chunk.linkId)
    expect(linked).toContain('#term-repository')
  })

  it('treats "add" and "follow" as the same idea (ALT table)', () => {
    // The GROUPS table makes these synonyms. A query for "follow" has
    // to find the paragraph that uses "add", and vice versa.
    const chunks = buildChunks(mockDoc())
    const addQuery = rank('add', chunks)
    const followQuery = rank('follow', chunks)
    expect(addQuery.hits.length).toBeGreaterThan(0)
    expect(followQuery.hits.length).toBeGreaterThan(0)
    // Both queries should reach the same section at the top — same idea.
    expect(addQuery.hits[0].chunk.linkId).toBe('#adding')
    expect(followQuery.hits[0].chunk.linkId).toBe('#adding')
  })

  it('returns nothing for a query that touches nothing', () => {
    const chunks = buildChunks(mockDoc())
    const r = rank('xyzzy', chunks)
    expect(r.hits).toEqual([])
  })

  it('honours the stop-word list', () => {
    // "What is the" is nothing but stop words. The ranker should see
    // no ideas and return an empty result — the real failure mode
    // would be returning every chunk because "the" appears everywhere.
    const chunks = buildChunks(mockDoc())
    const r = rank('what is the', chunks)
    expect(r.ideas).toEqual([])
    expect(r.hits).toEqual([])
  })
})

describe('buildChunks', () => {
  it('walks paragraphs and list items into separate chunks', () => {
    // The point of chunking is that a two-paragraph section becomes
    // two scorable units. The templated page does the same walk — if
    // this stopped matching, the "best covered" set would collapse to
    // whole sections and hit counts would halve.
    const chunks = buildChunks(mockDoc())
    const addingChunks = chunks.filter((c) => c.linkId === '#adding')
    // Two paragraphs plus two list items — the templated filter skips
    // paragraphs inside list items, but these are top-level.
    expect(addingChunks.length).toBeGreaterThanOrEqual(4)
  })

  it('weighs a glossary term by its label (lead words)', () => {
    // A glossary entry whose label is the query should beat a mere
    // body mention. The +4 head weight and +3 all-lead-covered bonus
    // are what make that happen.
    const chunks = buildChunks(mockDoc())
    const r = rank('alert', chunks)
    expect(r.hits[0].chunk.linkId).toBe('#term-alert')
  })
})
