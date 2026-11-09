import type { HelpDoc, HelpSection, HelpTerm } from '../data/help'

/**
 * Help-page search — port of the templated page's ranker.
 *
 * The templated /help carried this: a stop-word list, a tiny English
 * stemmer, an alternatives table ("repository"/"repo"/"project" all
 * stem to the same group), and a scored chunk match. The React port
 * swapped that for a substring filter, which failed on the exact
 * phrasing the placeholder invites — "how to add a repo" returned
 * nothing, because "add" is stemmed from "adding" in the original
 * and the substring match didn't know that. Issue #293.
 *
 * This file is the port. Logic matches `web/help.html` lines ~139–230
 * — same STOP words, same stem rules, same GROUPS, same scoring. The
 * two changes forced by the React shape:
 *
 *   1. Chunks come from parsing `section.html` with DOMParser rather
 *      than walking the live DOM, since React renders sections via
 *      `dangerouslySetInnerHTML` and the ranker runs ahead of any
 *      element ids we could anchor to.
 *   2. Hits link to the containing section's id (the h2 anchor) rather
 *      than the exact element, since the server does not emit
 *      per-element ids and inventing them here would duplicate the
 *      structure we parse from.
 *
 * Both are losses the ticket accepts: the scored, stemmed ranking is
 * the thing being restored. Per-element deep links can come later if
 * the server starts emitting them.
 */

// Stop words — copied verbatim from the templated page so the two
// implementations agree on which words should never drive a hit.
const STOP: Record<string, 1> = {}
;(
  'a an and are as at be but by can could did do does doing for from get got have how i if in into is it its ' +
  'me my of on or so that the then there these this those to too was way what when where which who why will ' +
  'with would you your yours want wanted need should please tell about mean means meaning'
)
  .split(' ')
  .forEach((w) => {
    STOP[w] = 1
  })

/**
 * Tiny English stemmer — the same four rules as the templated page.
 * Each rule has a minimum word length because trimming "is" to nothing
 * or "ed" to empty would collapse half the dictionary into stop words.
 */
export function stem(w: string): string {
  if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3)
  if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2)
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1)
  return w
}

// Alternatives — groups of synonyms the ranker treats as the same idea.
// "add" matches "follow"; "repo" matches "repository" or "project"; a
// user who types what they would say gets to the right chunk.
const GROUPS = [
  'repository repo project',
  'add follow',
  'remove delete untrack stop drop hide unfollow',
  'pr pull',
  'alert cell indicator light annunciator',
  'clear dismiss acknowledge ack seen silence',
  'notification notify inbox',
  'issue ticket',
  'token key credential auth',
  'setting config configure configuration option',
  'colour color theme dark mode',
  'shortcut keyboard hotkey',
  'layout arrange rearrange customize preset panel',
  'version release update build',
  'slow slowing dormant quiet inactive stale',
  'error fail broken problem wrong troubleshoot',
  'search find filter',
  'mascot cat kitten',
  'merge merged',
  'privacy private data',
  'start launch run restart',
]

const ALT: Record<string, string[]> = {}
GROUPS.forEach((g) => {
  const ws = g.split(' ').map(stem)
  ws.forEach((w) => {
    ALT[w] = ws
  })
})

/** Tokenise, drop stop words, stem. The only text-processing primitive. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((w) => !STOP[w])
    .map(stem)
}

export type HelpChunk = {
  /** Stable key for React. */
  key: string
  /** Anchor to scroll to — section id or glossary-term id. */
  linkId: string
  kind: 'section' | 'glossary'
  /** Section title for the "where" label on a hit. */
  sectionTitle: string
  /** Sub-heading (h3) if the chunk was under one, else empty. */
  sub: string
  /** Display text for the snippet. */
  text: string
  /** Stemmed words from `text`. */
  words: string[]
  /** Stemmed words from the chunk's leading bold/strong/dt — these
   *  are weighted higher by rank, matching the templated page. */
  lead: string[]
  /** Stemmed words from the sub-heading. */
  subWords: string[]
  /** Stemmed words from the section title. */
  sect: string[]
}

/**
 * Walk a section's rendered HTML and emit one chunk per paragraph,
 * list item, table row or dt, matching the templated page's DOM walk.
 *
 * The filters replicate the templated page's `forEach`: skip h3s (they
 * become `sub` state for subsequent chunks), skip nested paragraphs
 * inside li/td (the outer one already carries the text), skip header
 * rows, skip toc list items. The only difference is parsing a string
 * with DOMParser rather than walking the live document — this runs
 * once per data load, not per keystroke, so the parse cost is amortised.
 */
function chunksFromSectionHtml(section: HelpSection): HelpChunk[] {
  if (typeof DOMParser === 'undefined') return []
  const dom = new DOMParser().parseFromString(
    `<div>${section.html}</div>`,
    'text/html',
  )
  const root = dom.body.firstElementChild
  if (!root) return []

  const sectWords = words(section.title)
  const result: HelpChunk[] = []
  let sub = ''
  let subW: string[] = []

  const nodes = root.querySelectorAll('h3, p, li, tr, dt')
  nodes.forEach((el, i) => {
    if (el.tagName === 'H3') {
      sub = el.textContent?.trim() ?? ''
      subW = words(sub)
      return
    }
    if (el.tagName === 'DT' && !el.closest('.kv')) return
    if (el.tagName === 'LI' && el.closest('.toc')) return
    if (el.tagName === 'P' && el.closest('li, td')) return
    if (el.tagName === 'TR' && el.querySelector('th')) return

    const base =
      el.tagName === 'DT'
        ? (el.textContent ?? '') +
          ' ' +
          (el.nextElementSibling?.textContent ?? '')
        : (el.textContent ?? '')
    const text = base.replace(/\s+/g, ' ').trim()
    if (text.length < 3) return

    const lead = el.querySelector('strong, b, dt')
    const leadText = lead?.textContent ?? ''

    result.push({
      key: `${section.id}-${i}`,
      linkId: `#${section.id}`,
      kind: 'section',
      sectionTitle: section.title,
      sub,
      text,
      words: words(text),
      lead: words(leadText),
      subWords: subW,
      sect: sectWords,
    })
  })

  return result
}

/**
 * Glossary terms become chunks too. The templated page walks `.gi`
 * elements that live inside the glossary section; the React page
 * keeps them in a separate list, so we fabricate the equivalent chunk
 * here: label is the "lead" (bold-weight match), the full means/do
 * text is the body, and the section is "Glossary".
 */
function chunkFromTerm(term: HelpTerm): HelpChunk {
  const body = [term.label, term.means, term.do].filter(Boolean).join(' — ')
  return {
    key: `term-${term.id}`,
    linkId: `#term-${term.id}`,
    kind: 'glossary',
    sectionTitle: 'Glossary',
    sub: term.kind,
    text: body,
    words: words(body),
    lead: words(term.label),
    subWords: words(term.kind),
    sect: words('Glossary'),
  }
}

export function buildChunks(d: HelpDoc): HelpChunk[] {
  const out: HelpChunk[] = []
  for (const s of d.sections) out.push(...chunksFromSectionHtml(s))
  for (const t of d.glossary) out.push(chunkFromTerm(t))
  return out
}

function has(list: string[], alts: string[]): boolean {
  for (const a of alts) if (list.indexOf(a) !== -1) return true
  return false
}

function prefixHas(list: string[], w: string): boolean {
  for (const s of list) if (s.indexOf(w) === 0) return true
  return false
}

export type HelpHit = {
  chunk: HelpChunk
  score: number
  covered: number
}

export type HelpRankResult = {
  ideas: string[][]
  hits: HelpHit[]
  /** True when the best-covered hits touch every query idea — the
   *  templated page uses this to flip the "best first" heading to the
   *  "closest matches" heading. */
  exact: boolean
}

/**
 * Score every chunk against the query, keep the ones with the highest
 * coverage, sort by descending score, cap at 12.
 *
 * Scoring mirrors the templated page:
 *   +2  idea appears in the chunk's body text (or prefix-matches the
 *       last word while the user is still typing — the "typing" branch
 *       is what makes "add" match as the user types "a", "ad", "add").
 *   +4  idea appears in the chunk's leading bold / dt.
 *   +2  idea appears in the sub-heading.
 *   +1  idea appears in the section title.
 *   +1  the chunk reads like a question ("How do I...?"). Questions
 *       are usually the answer to a search.
 *   +3  every word of the lead is covered. A glossary entry whose
 *       label is "add repository" and matches "add repository"
 *       deserves to beat an incidental paragraph that happens to
 *       mention both words.
 *   -length/600  longer chunks pay a mild length penalty, up to -1, so
 *       a 10-word answer outranks a 500-word tangent.
 *
 * "Covered" is the count of query ideas that touched the chunk at all;
 * only chunks with the highest `covered` survive. This keeps the hit
 * list honest: a query of two ideas only shows chunks that found both.
 */
export function rank(query: string, chunks: HelpChunk[]): HelpRankResult {
  const ideas: string[][] = []
  words(query).forEach((w) => {
    if (!ideas.some((x) => x.indexOf(w) !== -1)) ideas.push(ALT[w] || [w])
  })
  if (!ideas.length) return { ideas, hits: [], exact: false }

  const last = ideas.length - 1
  const typing = !/\s$/.test(query)

  const scored = chunks
    .map((c) => {
      let covered = 0
      let score = 0
      ideas.forEach((alts, i) => {
        const inText =
          has(c.words, alts) ||
          (i === last &&
            typing &&
            alts.length === 1 &&
            alts[0].length >= 3 &&
            prefixHas(c.words, alts[0]))
        const inHead = has(c.lead, alts)
          ? 4
          : has(c.subWords, alts)
            ? 2
            : has(c.sect, alts)
              ? 1
              : 0
        if (inText || inHead) covered++
        score += (inText ? 2 : 0) + inHead
      })
      if (/^(How|What|Why|Where|When|Can|Do|Does|Is)\b.*\?/.test(c.text)) score += 1
      if (
        c.lead.length &&
        c.lead.every((w) => ideas.some((alts) => alts.indexOf(w) !== -1))
      ) {
        score += 3
      }
      score -= Math.min(c.text.length, 600) / 600
      return { chunk: c, covered, score }
    })
    .filter((x) => x.covered > 0)

  const best = scored.reduce((m, x) => Math.max(m, x.covered), 0)
  const hits = scored
    .filter((x) => x.covered === best)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
  return { ideas, hits, exact: best === ideas.length }
}

export type SnippetPiece = { text: string; mark: boolean }

/**
 * Cut a ~220-character window around the first match in the chunk and
 * flag the matched tokens for highlighting. The window starts 70 chars
 * before the first match (snapped to a word boundary), extends 220
 * chars, and prefixes/suffixes an ellipsis when it clipped the chunk.
 *
 * Same rules as the templated page — the only difference is returning
 * a list of pieces instead of a DocumentFragment, so React can render
 * them without reaching for dangerouslySetInnerHTML.
 */
export function snippet(c: HelpChunk, ideas: string[][]): SnippetPiece[] {
  const text = c.text
  const lower = text.toLowerCase()
  const re = /[a-z0-9]+/g
  const spans: [number, number][] = []
  let first = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(lower))) {
    const w = stem(m[0])
    if (
      !STOP[m[0]] &&
      ideas.some(
        (alts) =>
          alts.indexOf(w) !== -1 ||
          (alts.length === 1 && alts[0].length >= 3 && w.indexOf(alts[0]) === 0),
      )
    ) {
      spans.push([m.index, m.index + m[0].length])
      if (first < 0) first = m.index
    }
  }
  let from = Math.max(0, first - 70)
  const to = Math.min(text.length, from + 220)
  if (from > 0) {
    const nextSpace = text.indexOf(' ', from)
    from = nextSpace >= 0 ? nextSpace + 1 : from
  }

  const pieces: SnippetPiece[] = []
  if (from > 0) pieces.push({ text: '… ', mark: false })
  let at = from
  for (const sp of spans) {
    if (sp[0] < at || sp[1] > to) continue
    if (sp[0] > at) pieces.push({ text: text.slice(at, sp[0]), mark: false })
    pieces.push({ text: text.slice(sp[0], sp[1]), mark: true })
    at = sp[1]
  }
  const tail = text.slice(at, to) + (to < text.length ? ' …' : '')
  if (tail) pieces.push({ text: tail, mark: false })
  return pieces
}
