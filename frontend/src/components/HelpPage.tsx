import { useMemo, useState } from 'react'
import { AlertTriangle, Copy } from 'lucide-react'
import { useHelp, type HelpSection, type HelpTerm } from '../data/help'
import { usePageTitle } from '../hooks/usePageTitle'

/**
 * The /help page.
 *
 * Most of this is server-rendered HTML — a goldmark pass over the guide
 * Markdown with the server's own link rewriter. The reasons that stays
 * on the server are in `data/help.ts`. The React side's job is layout,
 * TOC navigation, the simple search, and the one write-free action —
 * copying the AI prompt to the clipboard.
 *
 * SEARCH IS NOT THE TEMPLATED PAGE'S RANKER. The templated page carries
 * a stemmed, scored ranker over ~200 lines of JS. The React page swaps
 * that for a substring-match filter over section text and glossary
 * labels. The ranker is a feature worth preserving but not worth
 * blocking this port on; follow it up when the templated page itself
 * is removed.
 *
 * KNOWN IS NOT A STATUS. The About section's live rows (Last check,
 * GitHub API this hour, Notifications) carry their own `known` flag.
 * A row that has not been learned yet renders an em-dash rather than
 * a server-typed string that could read as a real answer.
 */

type SearchMatch =
  | { kind: 'section'; section: HelpSection }
  | { kind: 'term'; term: HelpTerm }

export function HelpPage() {
  usePageTitle('HelloGitty help')
  const q = useHelp()
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  const d = q.data

  const matches = useMemo<SearchMatch[]>(() => {
    if (!d) return []
    const needle = search.trim().toLowerCase()
    if (!needle) return []
    const hits: SearchMatch[] = []
    for (const section of d.sections) {
      const hay = (section.title + ' ' + section.text).toLowerCase()
      if (hay.includes(needle)) hits.push({ kind: 'section', section })
    }
    for (const term of d.glossary) {
      if (term.search.includes(needle)) hits.push({ kind: 'term', term })
    }
    return hits.slice(0, 20)
  }, [d, search])

  const onCopyPrompt = async () => {
    if (!d) return
    try {
      await navigator.clipboard.writeText(d.aiPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* some browsers refuse without a secure origin; the <pre> is still there to copy from */
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-4">
      {/* The search box, above the content so it's visible at the top. */}
      <div className="mb-4 flex items-center">
        <label className="flex-1 max-w-[420px]">
          <span className="sr-only">Search help</span>
          <input
            type="search"
            placeholder="Ask or search, e.g. how to add a repo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full border px-2.5 py-1.5 text-[13px]"
            style={{
              background: 'var(--hg-surface)',
              borderColor: 'var(--hg-line-strong)',
              color: 'var(--hg-text)',
            }}
          />
        </label>
      </div>

      {q.isPending && (
        <p className="text-[12px]" style={{ color: 'var(--hg-text-muted)' }} role="status">
          Loading.
        </p>
      )}

      {q.isError && (
        <div
          role="alert"
          className="flex items-start gap-2 border px-4 py-3 text-[12px]"
          style={{ borderColor: 'var(--hg-danger)', color: 'var(--hg-danger)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{q.error.message}</span>
        </div>
      )}

      {search.trim() && matches.length === 0 && d && (
        <p
          role="status"
          className="text-[12.5px]"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          Nothing matches "{search.trim()}".
        </p>
      )}

      {search.trim() && matches.length > 0 && (
        <section className="mb-6" aria-label="Search results">
          <p className="mb-2 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {matches.length} {matches.length === 1 ? 'match' : 'matches'} for "{search.trim()}".
          </p>
          <ol className="list-none p-0">
            {matches.map((m) => (
              <li
                key={m.kind === 'section' ? `s-${m.section.id}` : `t-${m.term.id}`}
                className="border-t py-2"
                style={{ borderColor: 'var(--hg-line)' }}
              >
                {m.kind === 'section' ? (
                  <a href={`#${m.section.id}`} className="block no-underline hover:underline"
                     style={{ color: 'var(--hg-text)' }}>
                    <span className="text-[11px] uppercase tracking-wider"
                          style={{ color: 'var(--hg-text-muted)' }}>
                      Section
                    </span>
                    <span className="block text-[13px]">{m.section.title}</span>
                  </a>
                ) : (
                  <a
                    href={`#term-${m.term.id}`}
                    className="block no-underline hover:underline"
                    style={{ color: 'var(--hg-text)' }}
                  >
                    <span
                      className="text-[11px] uppercase tracking-wider"
                      style={{ color: 'var(--hg-text-muted)' }}
                    >
                      {m.term.kind}
                    </span>
                    <span className="block text-[13px]">{m.term.label}</span>
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-1 gap-7 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-labelledby="toc-h"
          className="text-[13px] md:sticky md:top-4 md:self-start"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          <h2 id="toc-h" className="mb-2 text-[12px] font-semibold uppercase tracking-wider">
            Contents
          </h2>
          <ol className="list-none space-y-0.5 p-0">
            {d?.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                  style={{ color: 'var(--hg-text-muted)' }}
                >
                  {s.title}
                </a>
              </li>
            ))}
            <li className="my-1.5 border-t" style={{ borderColor: 'var(--hg-line)' }} aria-hidden="true" />
            <li>
              <a href="#ai" className="block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                 style={{ color: 'var(--hg-text-muted)' }}>
                Use with an AI assistant
              </a>
            </li>
            <li>
              <a href="#glossary" className="block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                 style={{ color: 'var(--hg-text-muted)' }}>
                Glossary
              </a>
            </li>
            <li>
              <a href="#about" className="block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                 style={{ color: 'var(--hg-text-muted)' }}>
                About this install
              </a>
            </li>
          </ol>
        </nav>

        <main id="main" tabIndex={-1} className="min-w-0 hg-help-doc">
          {d && (
            <>
              <section className="pb-4">
                <h2 className="mb-2 text-[22px] font-semibold" style={{ color: 'var(--hg-text)' }}>
                  {d.title}
                </h2>
                {/* Intro is HTML from help.Render. See data/help.ts for why we trust it. */}
                <div
                  dangerouslySetInnerHTML={{ __html: d.intro }}
                  style={{ color: 'var(--hg-text)' }}
                />
              </section>

              {d.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="border-t py-5"
                  style={{ borderColor: 'var(--hg-line)' }}
                >
                  <h2 className="mb-3 text-[18px] font-semibold" style={{ color: 'var(--hg-text)' }}>
                    {section.title}
                  </h2>
                  <div
                    dangerouslySetInnerHTML={{ __html: section.html }}
                    style={{ color: 'var(--hg-text)' }}
                  />
                </section>
              ))}

              <section id="ai" className="border-t py-5" style={{ borderColor: 'var(--hg-line)' }}>
                <h2 className="mb-2 text-[18px] font-semibold" style={{ color: 'var(--hg-text)' }}>
                  Use with an AI assistant
                </h2>
                <p className="mb-2 text-[13.5px] leading-relaxed" style={{ color: 'var(--hg-text)' }}>
                  If you work with an AI coding assistant (Claude Code, Copilot, Cursor, or another),
                  it can keep HelloGitty up to date for you: follow the repositories you start
                  working in, watch the issues you comment on, or turn your project's task list into
                  pipeline stages. Copy this prompt into your assistant, replace the part in square
                  brackets with what you want, and it will propose the changes before making them.
                </p>
                <p className="mb-3 text-[13.5px] leading-relaxed" style={{ color: 'var(--hg-text)' }}>
                  The prompt names this install's own folder and files, and tells the assistant
                  the ground rules: no tokens in files, no edits to HelloGitty's database or code,
                  and nothing posted to GitHub.
                </p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={onCopyPrompt}
                    className="absolute right-2 top-2 inline-flex items-center gap-1 border px-2 py-1 text-[11.5px]"
                    style={{
                      borderColor: 'var(--hg-line-strong)',
                      background: 'var(--hg-surface-raised)',
                      color: 'var(--hg-text)',
                    }}
                  >
                    <Copy size={11} aria-hidden="true" />
                    {copied ? 'Copied' : 'Copy prompt'}
                  </button>
                  <pre
                    id="ai-prompt"
                    className="whitespace-pre-wrap break-words border px-3.5 pt-10 pb-3.5 font-mono text-[12.5px] leading-relaxed"
                    style={{
                      borderColor: 'var(--hg-line)',
                      background: 'var(--hg-surface)',
                      color: 'var(--hg-text)',
                    }}
                  >
                    {d.aiPrompt}
                  </pre>
                </div>
              </section>

              <section
                id="glossary"
                className="border-t py-5"
                style={{ borderColor: 'var(--hg-line)' }}
              >
                <h2 className="mb-2 text-[18px] font-semibold" style={{ color: 'var(--hg-text)' }}>
                  Glossary
                </h2>
                <p className="mb-3 text-[12.5px]" style={{ color: 'var(--hg-text-muted)' }}>
                  Every word and mark the dashboard explains when you hover it, in one place.
                </p>
                <dl className="divide-y" style={{ borderColor: 'var(--hg-line)' }}>
                  {d.glossary.map((term) => (
                    <div
                      key={term.id}
                      id={`term-${term.id}`}
                      className="grid grid-cols-1 gap-y-1 border-t py-2.5 md:grid-cols-[minmax(150px,220px)_minmax(0,1fr)] md:gap-x-4"
                      style={{ borderColor: 'var(--hg-line)' }}
                    >
                      <dt className="min-w-0">
                        <span className="font-semibold" style={{ color: 'var(--hg-text)' }}>
                          {term.label}
                        </span>
                        <span className="block text-[11.5px]" style={{ color: 'var(--hg-text-muted)' }}>
                          {term.kind}
                        </span>
                      </dt>
                      <dd className="m-0 min-w-0 text-[13.5px]" style={{ color: 'var(--hg-text)' }}>
                        {term.means}
                        {term.do && (
                          <span className="mt-0.5 block text-[12.5px]" style={{ color: 'var(--hg-text-muted)' }}>
                            {term.do}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section
                id="about"
                className="border-t py-5"
                style={{ borderColor: 'var(--hg-line)' }}
              >
                <h2 className="mb-2 text-[18px] font-semibold" style={{ color: 'var(--hg-text)' }}>
                  About this install
                </h2>
                <dl className="grid grid-cols-1 gap-y-2 md:grid-cols-[max-content_minmax(0,1fr)] md:gap-x-5">
                  {d.about.map((row, i) => (
                    <div key={`${row.key}-${i}`} className="contents">
                      <dt style={{ color: 'var(--hg-text-muted)' }}>{row.key}</dt>
                      <dd className="m-0 min-w-0 break-words text-[13.5px]"
                          style={{ color: row.known ? 'var(--hg-text)' : 'var(--hg-text-muted)' }}>
                        {row.known ? (
                          row.url ? (
                            <a href={row.url} target="_blank" rel="noreferrer noopener"
                               style={{ color: 'var(--hg-text)' }}>
                              {row.value}
                            </a>
                          ) : (
                            row.value
                          )
                        ) : (
                          /*
                            Not yet learned — render an em-dash rather than
                            the server's placeholder string, matching the
                            alert-page convention. The row title still says
                            what the dash is a stand-in for.
                          */
                          <span data-testid={`about-unknown-${row.key.toLowerCase().replace(/\W+/g, '-')}`}>—</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
