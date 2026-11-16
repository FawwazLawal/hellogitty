import { useEffect, useState, type MouseEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

/**
 * The eye control: watch or stop watching one issue.
 *
 * Why this is its own component. Issue #292 is "watch affordance (eye
 * control) is missing from every list" — the templated UI carried this
 * on the feed, the Issues page, the Recent-issues panel and the
 * Watched-issues panel; the React port lost it everywhere. This is
 * where the shared affordance lives, so the four surfaces lift the
 * same control rather than four close-but-drifting copies.
 *
 * Scope boundary. The button owns the fetch, the aria state, the
 * visible banner on success and failure. It does NOT own the data
 * source — a feed row, an issue row, a Watched-issues list row all
 * come from different queries — so the parent passes the current
 * `watched` value and gets an `onToggled` callback for whatever cache
 * invalidation it owns. Keeping cache invalidation out of this
 * component is how one control serves four different query keys.
 *
 * Why the banner fires from here rather than the parent. The message
 * is about the result of the request, not about the row, and copying
 * the text into four parents would drift. The parent keeps the data,
 * the button keeps the "say what happened" string.
 */

type Props = {
  /** `owner/name#123`, the key the server parses in `splitKey`. */
  issueKey: string
  /** Current state as the parent sees it — flipped optimistically on click. */
  watched: boolean
  /** Session token for the X-HelloGitty-Token header. `undefined` while
   *  the session query is pending; the button is disabled in that case. */
  token: string | undefined
  /** Called after the server confirms the new state, so the parent can
   *  update its own cache. The server's `note` (shown only on success
   *  to turn on) is passed through in case a caller wants to log it. */
  onToggled?: (next: boolean, note?: string) => void
  /** Optional class merged after the component's own, for site-specific
   *  margin or positioning. */
  className?: string
}

type WatchResponse = {
  on: boolean
  note?: string
  error?: string
}

/**
 * Dispatches the banner message onto the window as a custom event so a
 * page-level `<WatchStatusBanner />` can render one banner no matter how
 * many eyes are on the page. Keeping this a global event (rather than
 * context or a store) avoids forcing every parent that uses the button
 * to wrap its tree in a provider — the templated page does the same by
 * appending a single `.eyemsg` div to `document.body` on first use.
 */
function say(text: string, bad = false) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('hg-watch-status', { detail: { text, bad } }),
  )
}

export function WatchEyeButton({
  issueKey,
  watched,
  token,
  onToggled,
  className,
}: Props) {
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (!token) throw new Error('this session cannot change what is watched (reload the page)')
      const res = await fetch('/watch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'X-HelloGitty-Token': token,
        },
        body: JSON.stringify({ key: issueKey, on: next }),
      })
      // 422 carries a well-formed body with the server's own error string
      // (`error`); 200 carries the final `on` plus an optional `note`. Both
      // are JSON, so parse first and look at `error` rather than branching
      // on the status code — matches what the templated handler does.
      let data: WatchResponse
      try {
        data = (await res.json()) as WatchResponse
      } catch {
        throw new Error(`HelloGitty didn't answer (${res.status})`)
      }
      if (data.error) throw new Error(data.error)
      return data
    },
    onSuccess: (data, next) => {
      onToggled?.(data.on, data.note)
      if (next) {
        const tail = data.note ? ` ${data.note}` : ''
        say(
          `Watching ${issueKey}. You'll hear if someone claims it or it closes; it's in Watched issues.${tail}`,
        )
      } else {
        say(`Stopped watching ${issueKey}.`)
      }
    },
    onError: (err: Error) => {
      say(err.message, true)
    },
  })

  const onClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle.mutate(!watched)
  }

  const label = watched ? `Stop watching ${issueKey}` : `Watch ${issueKey}`
  const title = watched
    ? "Watching: you'll hear if someone claims it or it closes. Click to stop."
    : 'Watch: hear if someone claims it or it closes'

  const classes = [
    'hg-watch-eye',
    watched ? 'on' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={toggle.isPending || !token}
      aria-pressed={watched}
      aria-label={label}
      title={title}
      className={classes}
      data-watch={issueKey}
    >
      {/*
        The eye glyph. Outline until watched, filled pupil once watched —
        same two SVG primitives as the templated page's inline SVG, so
        the two surfaces look identical side by side.
      */}
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    </button>
  )
}

/**
 * Page-level status banner the WatchEyeButton events feed into.
 *
 * One banner per page; mount this once near the top of a page that
 * uses `<WatchEyeButton />` and the component takes care of the rest.
 * Multiple mounts on one page are harmless — each renders its own
 * banner, and whichever is the latest to receive the event is the
 * visible one. In practice there is only ever one page in view.
 *
 * Rendering it in React (rather than the templated page's direct
 * `document.body.appendChild`) keeps the banner inside the component
 * tree so Suspense fallbacks, test unmount and hot reload all tear
 * it down cleanly.
 */
export function WatchStatusBanner() {
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => {
    let timer = 0
    const onStatus = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { text: string; bad?: boolean }
      setMsg({ text: detail.text, bad: !!detail.bad })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMsg(null), 5000)
    }
    window.addEventListener('hg-watch-status', onStatus)
    return () => {
      window.removeEventListener('hg-watch-status', onStatus)
      window.clearTimeout(timer)
    }
  }, [])

  if (!msg) return null
  return (
    <div className={`hg-watch-banner${msg.bad ? ' bad' : ''}`} role="status">
      {msg.text}
    </div>
  )
}
