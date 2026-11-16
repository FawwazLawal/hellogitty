import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Copy } from 'lucide-react'
import { useHelp } from '../data/help'
import { usePageTitle } from '../hooks/usePageTitle'
import { buildChunks, rank, snippet } from '../lib/helpSearch'

/**
 * The /help page.
 *
 * Most of this is server-rendered HTML — a goldmark pass over the guide
 * Markdown with the server's own link rewriter. The reasons that stays
 * on the server are in `data/help.ts`. The React side's job is layout,
 * TOC navigation, search with keyboard navigation, Copy buttons on
 * every code block, and a TOC scroll-spy.
 *
 * SEARCH is ported from the templated page's ranker: stop words, a
 * tiny stemmer, an alternatives table ("adding repos" → add + repo →
 * "add a repository"), and a scored chunk match. See `lib/helpSearch.ts`.
 *
 * KEYBOARD mirrors the templated handler:
 *   `/`     focuses the search box, except while focus is already in a
 *           form field (INPUT/TEXTAREA/SELECT/contenteditable) or any
 *           modifier is held — the templated version checks all of
 *           those, so copying a path or using the browser's Find
 *           keeps working.
 *   Esc     clears the search and blurs the input.
 *   Enter   opens the currently selected hit.
 *   ↑ / ↓   move the selection within the hit list.
 *
 * COPY BUTTONS on every `<pre>` are attached from a useEffect once the
 * server HTML is in the DOM — React renders section bodies via
 * `dangerouslySetInnerHTML`, so adding React controls to those nodes
 * would require re-rendering the string. Direct DOM mutation inside a
 * cleanup-guarded effect does what the templated page did. The AI
 * prompt pre already has its own Copy button, so it is skipped by id.
 *
 * TOC SCROLL-SPY uses IntersectionObserver with the same `rootMargin`
 * as the templated page, so a section the reader is looking at marks
 * its TOC entry with `aria-current="true"`. The CSS for the current
 * state lives next to the rest of `.hg-help-doc` in `index.css`.
 *
 * KNOWN IS NOT A STATUS. The About section's live rows (Last check,
 * GitHub API this hour, Notifications) carry their own `known` flag.
 * A row that has not been learned yet renders an em-dash rather than
 * a server-typed string that could read as a real answer.
 */

export function HelpPage() {
  usePageTitle('HelloGitty help')
  const q = useHelp()
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [sel, setSel] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  const d = q.data

  // Chunks come from parsing section HTML, so rebuild them only when
  // the doc itself changes — not on every keystroke.
  const chunks = useMemo(() => (d ? buildChunks(d) : []), [d])

  const results = useMemo(() => {
    if (!d || !search.trim()) return null
    return rank(search, chunks)
  }, [d, search, chunks])

  // Reset selection whenever the hit list changes so Enter never
  // dispatches to a hit the user never saw.
  useEffect(() => {
    setSel(0)
  }, [results])

  /**
   * Global `/` shortcut — focus the search box, matching the
   * templated handler. The guard list mirrors it exactly:
   *   - Not while the user is typing in an INPUT, TEXTAREA or SELECT,
   *     so `/` still inserts in a text field (the dashboard's `/feed`
   *     message filter, for instance).
   *   - Not in a contenteditable element, for the same reason — the
   *     templated handler misses this case; peer flagged it on the
   *     hand-off, so the port gets the stronger check.
   *   - Not while a modifier (meta / ctrl / alt / shift) is held, so
   *     browser shortcuts (⌘F "Find", ⌘/) keep their meaning.
   */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (!t) return
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (t.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /**
   * Scroll to the hit's anchor and give it a one-shot flash so the
   * reader finds the row they were looking at. The ids come from
   * `HelpChunk.linkId` and they are always `#section-id` or
   * `#term-id`, both of which already exist in the DOM.
   */
  const openHit = (i: number) => {
    const hit = results?.hits[i]
    if (!hit) return
    const el = document.getElementById(hit.chunk.linkId.slice(1))
    if (!(el instanceof HTMLElement)) return
    el.scrollIntoView({ block: 'start' })
    el.classList.remove('hg-help-flash')
    // Re-trigger the CSS animation by forcing a reflow between toggles.
    void el.offsetWidth
    el.classList.add('hg-help-flash')
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearch('')
      inputRef.current?.blur()
      return
    }
    if (!results || !results.hits.length) return
    if (e.key === 'Enter') {
      e.preventDefault()
      openHit(sel)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, results.hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    }
  }

  /**
   * Attach a Copy button to every `<pre>` the server-rendered HTML
   * contains. React renders those bodies with `dangerouslySetInnerHTML`
   * and does not own the child nodes, so a useEffect that mutates the
   * DOM is the direct equivalent of the templated handler. The cleanup
   * removes buttons before React re-renders on data refetch, so a new
   * help payload does not accumulate them.
   *
   * The AI prompt's `<pre id="ai-prompt">` already has its own React
   * Copy button, so it is skipped — if both sat side by side one would
   * confuse the other.
   */
  useEffect(() => {
    if (!d || !mainRef.current) return
    const root = mainRef.current
    const added: Array<{ btn: HTMLButtonElement; onClick: () => void }> = []

    root.querySelectorAll<HTMLPreElement>('pre').forEach((pre, i) => {
      if (pre.id === 'ai-prompt') return
      if (pre.parentElement?.querySelector(':scope > .hg-help-copy')) return

      // Wrap the pre so the button can position absolute in its corner.
      let wrap: HTMLElement
      if (pre.parentElement?.classList.contains('hg-help-copy-wrap')) {
        wrap = pre.parentElement
      } else {
        wrap = document.createElement('div')
        wrap.className = 'hg-help-copy-wrap'
        pre.replaceWith(wrap)
        wrap.appendChild(pre)
      }
      if (!pre.id) pre.id = `hg-help-code-${i}`

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'hg-help-copy'
      btn.textContent = 'Copy'
      btn.setAttribute('aria-controls', pre.id)
      btn.setAttribute('aria-label', 'Copy code to clipboard')

      const onClick = async () => {
        const text = pre.textContent ?? ''
        const label = 'Copy'
        const done = (ok: boolean) => {
          btn.textContent = ok ? 'Copied' : 'Select and copy it'
          window.setTimeout(() => {
            btn.textContent = label
          }, 1800)
        }
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            done(true)
            return
          }
          throw new Error('no clipboard')
        } catch {
          // Fallback for insecure contexts and browsers that refuse the
          // async clipboard API — select the pre's contents and let
          // execCommand('copy') do what it still does in every evergreen
          // browser. The templated page uses the same fallback.
          try {
            const range = document.createRange()
            range.selectNodeContents(pre)
            const s = window.getSelection()
            s?.removeAllRanges()
            s?.addRange(range)
            done(document.execCommand('copy'))
          } catch {
            done(false)
          }
        }
      }
      btn.addEventListener('click', onClick)
      wrap.appendChild(btn)
      added.push({ btn, onClick })
    })

    return () => {
      added.forEach(({ btn, onClick }) => {
        btn.removeEventListener('click', onClick)
        btn.remove()
      })
    }
  }, [d])

  /**
   * TOC scroll-spy. Mirrors the templated page's rootMargin so the
   * "current" TOC entry changes at the same reading line.
   *
   * Observes every section the TOC links to — that includes the three
   * synthetic sections the React page adds (Use with an AI assistant,
   * Glossary, About this install), which have hard-coded ids in the
   * JSX below.
   */
  useEffect(() => {
    if (!d) return
    if (typeof IntersectionObserver === 'undefined') return
    const ids = [...d.sections.map((s) => s.id), 'ai', 'glossary', 'about']
    const links = new Map<string, HTMLAnchorElement>()
    ids.forEach((id) => {
      const a = document.querySelector<HTMLAnchorElement>(
        `nav[aria-labelledby="toc-h"] a[href="#${id}"]`,
      )
      if (a) links.set(id, a)
    })
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null)
    if (!targets.length) return

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return
          const link = links.get(en.target.id)
          if (!link) return
          links.forEach((a) => a.removeAttribute('aria-current'))
          link.setAttribute('aria-current', 'true')
        })
      },
      { rootMargin: '-100px 0px -70% 0px' },
    )
    targets.forEach((t) => io.observe(t))
    return () => io.disconnect()
  }, [d])

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
        <label className="relative flex-1 max-w-[420px]">
          <span className="sr-only">Search help</span>
          <input
            ref={inputRef}
            type="search"
            placeholder="Ask or search, e.g. how to add a repo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            autoComplete="off"
            spellCheck={false}
            className="w-full border py-1.5 pl-2.5 pr-9 text-[13px]"
            style={{
              background: 'var(--hg-surface)',
              borderColor: 'var(--hg-line-strong)',
              color: 'var(--hg-text)',
            }}
          />
          {/*
            The hint for the `/` shortcut, same as the templated page.
            `aria-hidden` because the keyboard handler is what the user
            interacts with; the character is a visual label for it, not
            another control. `pointer-events-none` keeps clicks reaching
            the input underneath.
          */}
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 border px-1 text-[10.5px] font-mono leading-5"
            style={{
              borderColor: 'var(--hg-line)',
              background: 'var(--hg-surface-raised)',
              color: 'var(--hg-text-muted)',
            }}
          >
            /
          </kbd>
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

      {results && results.hits.length === 0 && d && (
        <p
          role="status"
          className="text-[12.5px]"
          style={{ color: 'var(--hg-text-muted)' }}
        >
          Nothing in Help mentions that. Try another word, or browse the contents.
        </p>
      )}

      {results && results.hits.length > 0 && (
        <section className="mb-6" aria-label="Search results">
          <p className="mb-2 text-[12px]" style={{ color: 'var(--hg-text-muted)' }}>
            {results.exact
              ? `${results.hits.length} ${results.hits.length === 1 ? 'answer' : 'answers'}, best first. Enter opens the first.`
              : 'Nothing mentions all of that. Closest matches:'}
          </p>
          <ol className="list-none p-0" role="listbox" aria-label="Search hits">
            {results.hits.map((h, i) => (
              <li
                key={h.chunk.key}
                role="option"
                aria-selected={i === sel}
                className="border-t"
                style={{
                  borderColor: 'var(--hg-line)',
                  background: i === sel ? 'var(--hg-surface-raised)' : 'transparent',
                }}
              >
                <a
                  href={h.chunk.linkId}
                  onClick={(e) => {
                    e.preventDefault()
                    setSel(i)
                    openHit(i)
                  }}
                  className="block py-2 px-2 no-underline hover:underline"
                  style={{ color: 'var(--hg-text)' }}
                >
                  <span
                    className="text-[11px] uppercase tracking-wider"
                    style={{ color: 'var(--hg-text-muted)' }}
                  >
                    {h.chunk.sectionTitle}
                    {h.chunk.sub ? ` › ${h.chunk.sub}` : ''}
                  </span>
                  <span className="block text-[13px]">
                    {snippet(h.chunk, results.ideas).map((piece, j) =>
                      piece.mark ? (
                        <mark
                          key={j}
                          style={{
                            background: 'var(--hg-highlight, var(--hg-surface-raised))',
                            color: 'var(--hg-text)',
                          }}
                        >
                          {piece.text}
                        </mark>
                      ) : (
                        <span key={j}>{piece.text}</span>
                      ),
                    )}
                  </span>
                </a>
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
                  className="hg-help-toc-link block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                  style={{ color: 'var(--hg-text-muted)' }}
                >
                  {s.title}
                </a>
              </li>
            ))}
            <li className="my-1.5 border-t" style={{ borderColor: 'var(--hg-line)' }} aria-hidden="true" />
            <li>
              <a href="#ai" className="hg-help-toc-link block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                 style={{ color: 'var(--hg-text-muted)' }}>
                Use with an AI assistant
              </a>
            </li>
            <li>
              <a href="#glossary" className="hg-help-toc-link block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                 style={{ color: 'var(--hg-text-muted)' }}>
                Glossary
              </a>
            </li>
            <li>
              <a href="#about" className="hg-help-toc-link block rounded px-2 py-1 no-underline hover:bg-[var(--hg-surface-raised)]"
                 style={{ color: 'var(--hg-text-muted)' }}>
                About this install
              </a>
            </li>
          </ol>
        </nav>

        <main id="main" tabIndex={-1} className="min-w-0 hg-help-doc" ref={mainRef}>
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
