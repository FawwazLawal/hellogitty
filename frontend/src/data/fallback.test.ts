import { describe, expect, it } from 'vitest'

/**
 * The fallback rule, as a test rather than a comment.
 *
 * This shipped wrong to a live dashboard: the condition was
 * `repos.length > 0 ? live : fixture`, which treats "the server says you track
 * nothing" identically to "the server did not answer". The result rendered
 * openai/codex and flutter/flutter to someone tracking neither — demo data
 * wearing the clothes of real data, which is worse than an empty table because
 * nothing about it looks wrong.
 *
 * The distinction the code must keep: a fixture stands in for NO ANSWER, never
 * for a quiet one.
 */

/** The decision under test, extracted so it can be exercised directly. */
function chooseRepos<T>(
  query: { isSuccess: boolean; data?: { repos: T[] } },
  fixture: T[],
): { source: 'live' | 'fixture'; repos: T[] } {
  const answered = query.isSuccess && query.data !== undefined
  return answered
    ? { source: 'live', repos: query.data!.repos }
    : { source: 'fixture', repos: fixture }
}

const FIXTURE = ['openai/codex', 'flutter/flutter']

describe('live data versus the fixture', () => {
  it('uses live data when the server answers with rows', () => {
    const r = chooseRepos({ isSuccess: true, data: { repos: ['me/mine'] } }, FIXTURE)
    expect(r.source).toBe('live')
    expect(r.repos).toEqual(['me/mine'])
  })

  it('TRUSTS AN EMPTY ANSWER rather than substituting the fixture', () => {
    const r = chooseRepos({ isSuccess: true, data: { repos: [] } }, FIXTURE)
    expect(r.source, 'an empty answer is an answer; showing demo repositories here is a lie that looks like data').toBe('live')
    expect(r.repos).toEqual([])
  })

  it('falls back only when there is no answer', () => {
    expect(chooseRepos({ isSuccess: false }, FIXTURE).source).toBe('fixture')
    expect(chooseRepos({ isSuccess: true, data: undefined }, FIXTURE).source).toBe('fixture')
  })
})
