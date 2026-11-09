import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ChecksPanel } from './ChecksPanel'
import { ThemeProvider } from '../theme/ThemeProvider'

function renderInTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

/**
 * The panel's one real job is to tell honest truth about unknown vs known.
 * "Known with a real number" and "known with no number because the cycle
 * aborted" are different states, and the second one is the one that lies
 * when the UI renders zero.
 *
 * The critical fixture below (`cycleAborted`) carries the state that
 * disproved the first draft of the server-side gate: `polling.known: true`
 * with `lastCycleMs: 0` and `callsPerCycle: 0`. That state is representable
 * on the wire — a rate-limited cycle ticks `polling.known` from the per-repo
 * poll it finished first, but leaves the two cycle measurements at zero. A
 * client that gates its em-dash on `!polling.known` renders "0 ms" and
 * "0 calls" for that state, which is a real fast-looking number for a cycle
 * that never finished.
 *
 * So these tests pass the ZERO explicitly rather than an absent value, and
 * assert the em-dash for both. An absent value would stay green against a
 * component that renders `0` as "0"; zero is the case that lies.
 */

const whole = {
  polling: {
    intervalMinutes: 5,
    workIntervalMinutes: 2,
    lastPollUnix: 1_762_000_000,
    lastPollUtc: '12:34:56Z',
    nextPollUtc: '12:39Z',
    known: true,
    lastCycleMs: 1250,
  },
  api: {
    known: true,
    used: 42,
    limit: 5000,
    percent: 1,
    resetUtc: '13:01Z',
    callsPerCycle: 42,
  },
}

const cycleAborted = {
  polling: {
    intervalMinutes: 5,
    workIntervalMinutes: 2,
    lastPollUnix: 1_762_000_000,
    lastPollUtc: '12:34:56Z',
    nextPollUtc: '12:39Z',
    // The per-repo poll completed, so this is TRUE.
    known: true,
    // The cycle aborted on rate-limit before telemetry recorded the duration.
    lastCycleMs: 0,
  },
  api: {
    known: true,
    used: 42,
    limit: 5000,
    percent: 1,
    resetUtc: '13:01Z',
    // Comes from the same `tel.CycleDuration > 0` block on the server; both
    // fields go to zero together when a cycle aborts.
    callsPerCycle: 0,
  },
}

const beforeFirstPoll = {
  polling: {
    intervalMinutes: 5,
    workIntervalMinutes: 2,
    lastPollUnix: 0,
    lastPollUtc: '',
    nextPollUtc: '',
    known: false,
    lastCycleMs: 0,
  },
  api: {
    known: false,
    used: 0,
    limit: 0,
    percent: 0,
    resetUtc: '',
    callsPerCycle: 0,
  },
}

describe('ChecksPanel', () => {
  it('renders every row with its figure when the server has everything', () => {
    renderInTheme(<ChecksPanel data={whole} />)

    expect(screen.getByText('Last check finished')).toBeDefined()
    expect(screen.getByText('12:34:56Z')).toBeDefined()
    expect(screen.getByText('Next check')).toBeDefined()
    expect(screen.getByText('12:39Z')).toBeDefined()
    expect(screen.getByText('Checks run every')).toBeDefined()
    expect(screen.getByText('5 min')).toBeDefined()
    expect(screen.getByText('Last check took')).toBeDefined()
    expect(screen.getByText('1.25s')).toBeDefined()
    expect(screen.getByText('API calls per check')).toBeDefined()
    expect(screen.getByText('42')).toBeDefined()
    expect(screen.getByText('API quota resets')).toBeDefined()
    expect(screen.getByText('13:01Z')).toBeDefined()
    expect(screen.getByText('Your work refresh')).toBeDefined()
    expect(screen.getByText('2 min')).toBeDefined()
    const link = screen.getByRole('link', { name: 'snapshot.json' }) as HTMLAnchorElement
    expect(link.href).toMatch(/\/snapshot\.json$/)
  })

  /*
    The critical case. `polling.known` is TRUE and the two cycle numbers are
    ZERO. A component that reads `polling.known` to decide the em-dash would
    render "0 ms" and "0 calls" here. That is the specific bug this suite
    exists to catch — see the comment at the top of this file.
  */
  it('renders em-dash when polling.known is true but the cycle never finished recording', () => {
    const { container } = renderInTheme(<ChecksPanel data={cycleAborted} />)

    // Last check finished IS reported — polling.known says so.
    expect(screen.getByText('12:34:56Z')).toBeDefined()
    expect(screen.queryByText('not yet')).toBeNull()

    // But the two cycle fields must be em-dash, not "0 ms" / "0".
    const findRowValue = (label: string): string => {
      const dt = screen.getByText(label)
      const dd = dt.nextElementSibling
      return dd?.textContent?.trim() ?? ''
    }
    expect(findRowValue('Last check took')).toBe('—')
    expect(findRowValue('API calls per check')).toBe('—')

    // No "0 ms" or stray "0" rendered in either row — guards against a
    // future change that slips a zero into one of the two values.
    const takenDd = screen.getByText('Last check took').nextElementSibling as HTMLElement
    expect(within(takenDd).queryByText('0')).toBeNull()
    expect(within(takenDd).queryByText('0 ms')).toBeNull()
    const callsDd = screen.getByText('API calls per check').nextElementSibling as HTMLElement
    expect(within(callsDd).queryByText('0')).toBeNull()

    // The panel still renders every row (no accidental early return).
    expect(container.querySelectorAll('dt')).toHaveLength(8)
  })

  it('renders not-yet / starting / em-dash before the first poll', () => {
    renderInTheme(<ChecksPanel data={beforeFirstPoll} />)
    expect(screen.getByText('not yet')).toBeDefined()
    expect(screen.getByText('starting')).toBeDefined()
    // Three em-dash rows: lastCycleMs=0, callsPerCycle=0, api.known=false.
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  // workIntervalMinutes is startup config, not telemetry. In production the
  // binary always wires it from a const in main.go; zero only appears in test
  // fakes or malformed configs. The panel renders em-dash on zero — the same
  // treatment as the cycle fields — because "0 min" would read as "refreshes
  // immediately", which is also a false number. Pinning the decision so a
  // future refactor cannot inherit the ambiguity by default.
  it('renders em-dash for workIntervalMinutes when it is zero', () => {
    const data = { ...whole, polling: { ...whole.polling, workIntervalMinutes: 0 } }
    renderInTheme(<ChecksPanel data={data} />)
    const dt = screen.getByText('Your work refresh')
    const dd = dt.nextElementSibling as HTMLElement
    expect(dd.textContent?.trim()).toBe('—')
    expect(within(dd).queryByText(/0\s*min/)).toBeNull()
  })
})
