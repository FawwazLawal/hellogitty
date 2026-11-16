import { useEffect } from 'react'

/**
 * Set `document.title` for the mounted page.
 *
 * Every templated page set its own `<title>` and the React shell inherited
 * Vite's scaffold default — "frontend" — on all of them. That left the
 * browser tab identical across thirteen pages, which is a parity regression
 * caught in the audit at `PARITY-INVENTORY.md` (universal, finding 9+).
 *
 * The hook mirrors what a templated page did: set the title on mount,
 * restore it on unmount so navigating away does not leave a stale title
 * behind — which matters when the SPA shell survives route changes and
 * Chrome's tab title would otherwise freeze on the last one visited.
 *
 * A `null` title is the "do nothing" case, so App.tsx can call the hook
 * unconditionally while only owning the title on the one route where no
 * sub-page component does — the dashboard. Hooks must be called in the
 * same order every render; branching by returning early in the effect
 * keeps the hook call stable while letting the behaviour depend on route.
 *
 * ORDERING. React runs CHILD effects before parent effects, so a parent
 * that always set a title would always clobber the child's. That is why
 * App passes `null` for every non-dashboard view: so the sub-page's
 * effect is the last one to run and the title it set holds. Lazy-loaded
 * sub-pages (AlertsRouter, ListPage, ReposPage) mount AFTER App's effect
 * has already run, so they would overwrite even an always-set parent
 * title — which is what hid this bug during a first-pass check.
 *
 * The caller passes the fully formed title. The templated pages used two
 * shapes — "Settings · HelloGitty" and "HelloGitty help" / "HelloGitty
 * live" — and both shapes are preserved verbatim rather than normalised,
 * because "match the templated titles exactly" was the ask.
 */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
