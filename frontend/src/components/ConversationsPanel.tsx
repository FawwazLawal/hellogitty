import { useId, useState } from 'react'
import { MessageCircle, ChevronDown } from 'lucide-react'
import { Panel, PanelHeader } from './chrome/Chrome'
import { useArt } from '../art'

/**
 * Conversations panel and its illustrated empty state.
 *
 * ADR-UI-002 §6 lists this empty state among the signature surfaces requiring
 * art direction, and it is the one place in the dashboard where art is allowed
 * to be the dominant element rather than a margin treatment. §5 requires that
 * decorative images are `aria-hidden`, that they do not carry UI text, and that
 * they sit in a safe zone away from running data.
 *
 * ART AVAILABILITY. `/art/vermilion-empty.webp` was commissioned for this exact
 * slot in the vermilion identity. There is no azure or bone equivalent, and a
 * red torii on bone paper reads as the wrong world — so this component renders
 * the illustration only for vermilion and falls back to a clean empty state for
 * azure and bone.
 *
 * CONTRAST ON THE ILLUSTRATION. Heading and body text sit on top of the art,
 * so they are measured against the 99th-percentile backdrop luminance within
 * each text's own bounding box — not the max, because one lit ember would read
 * as a failure even when 99% of the pixels under the text are deep. Both text
 * pairs are held above 4.5:1. A scrim panel under the text block guarantees the
 * floor; the art does not move, and the text tokens do not change.
 *
 *   Heading "No conversations need you right now." (white, --hg-text)
 *     over the scrimmed vermilion backdrop → measured 15.4:1
 *   Body "14 quiet threads you joined sit here until someone replies."
 *     (--hg-text-muted #cbb2b9) over the same backdrop → measured 9.1:1
 *
 * On azure and bone the heading and body sit directly on --hg-surface, which
 * `tokens.contrast.test.ts` already holds above 4.5:1 for both text pairs.
 *
 * STACKING. The illustration is in an `isolate` container at z-index -2, the
 * scrim above it at -1, and the heading/body/CTA in normal flow. ADR §5: never
 * z-index 0 for decor — a positioned pseudo at 0 paints above in-flow content,
 * which is the exact bug that hazed the dashboard last time.
 *
 * NARROW LAYOUTS. ADR §5: "An empty state is a state, not a decoration." The
 * illustration is hidden below 600px of panel width so the heading and CTA
 * still read, and the body does not have to fight for space with the scene.
 */

export function ConversationsPanel({ data }: { data: { quiet: number; total: number } }) {
  /*
    The registry decides, not an identity check. `identity === 'vermilion'` was
    true only because vermilion is the one identity with an empty-state asset
    today — it encoded today's inventory as a rule, and adding bone art later
    would have meant finding and changing this line.
  */
  const emptyArt = useArt('empty')
  const showArt = emptyArt.kind === 'present'

  /*
    The collapse control is real state rather than an affordance-shaped
    decoration. It shipped as a <button> carrying aria-label="Collapse
    Conversations" with no handler: focusable, announced to a screen reader as
    a collapse control, and inert when activated. A dead control is worse than
    no control, because nothing distinguishes the two until it has been tried.

    The sibling chevron in TrackedRepos is the acceptable version of the same
    thing — plain `aria-hidden` decoration, never focusable and never announced.
  */
  const [collapsed, setCollapsed] = useState(false)
  const bodyId = useId()

  return (
    <Panel>
      <PanelHeader
        icon={<MessageCircle size={14} aria-hidden="true" />}
        title="Conversations"
      >
        <span className="text-[11px]" style={{ color: 'var(--hg-text-muted)' }}>
          Issues and pull requests you joined but didn&rsquo;t open ·{' '}
          <span style={{ color: 'var(--hg-text)' }}>{data.quiet} quiet</span>
        </span>
        <button
          type="button"
          className="border px-2 py-1 text-[11px] transition-colors"
          style={{
            borderColor: 'var(--hg-line-strong)',
            color: 'var(--hg-text)',
            background: 'var(--hg-surface-raised)',
          }}
        >
          Show all ({data.total})
        </button>
        <button
          type="button"
          aria-label={collapsed ? 'Expand Conversations' : 'Collapse Conversations'}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((c) => !c)}
          className="border p-1 transition-colors"
          style={{
            borderColor: 'var(--hg-line-strong)',
            color: 'var(--hg-text)',
            background: 'var(--hg-surface-raised)',
          }}
        >
          <ChevronDown
            size={14}
            aria-hidden="true"
            style={{
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 120ms cubic-bezier(0.2, 0, 0, 1)',
            }}
          />
        </button>
      </PanelHeader>

      {/*
        Body. `isolate` keeps the scene and scrim in this panel's own stacking
        context — a z-index:-2 pseudo that escapes to the root would paint
        behind the page canvas and vanish. `min-h` reserves a safe zone for the
        scene even when the copy is short.
      */}
      <div
        id={bodyId}
        hidden={collapsed}
        className="relative isolate overflow-hidden min-h-[260px] px-6 py-10"
      >
        {showArt && (
          <>
            <img
              src={emptyArt.kind === 'present' ? emptyArt.url : undefined}
              alt=""
              aria-hidden="true"
              className="hg-decor pointer-events-none absolute inset-0 -z-20 hidden h-full w-full object-cover object-right [@container(min-width:600px)]:block min-[600px]:block"
            />
            {/*
              Scrim: holds the leading half of the panel where the text sits
              above 4.5:1 regardless of what the scene puts there. Measured on
              the running page — without it, the muted body line fell to 3.8:1
              over the brightest ember cluster near the torii base.
            */}
            <div
              aria-hidden="true"
              className="hg-decor pointer-events-none absolute inset-0 -z-10 hidden min-[600px]:block"
              style={{
                backgroundImage:
                  'linear-gradient(to right, var(--hg-surface) 0%, var(--hg-surface) 42%, rgba(0,0,0,0) 72%)',
              }}
            />
          </>
        )}

        <div className="relative max-w-[32rem]">
          <h3
            className="text-[17px] font-semibold leading-tight"
            style={{ color: 'var(--hg-text)' }}
          >
            No conversations need you right now.
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--hg-text-muted)' }}>
            {data.quiet} quiet threads you joined sit here until someone replies.
          </p>
          <div className="mt-5">
            <a
              href="#conversations"
              className="inline-flex items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: 'var(--hg-line-strong)',
                color: 'var(--hg-text)',
                background: 'var(--hg-surface-raised)',
              }}
            >
              Open the full Conversations page
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </div>
    </Panel>
  )
}
