import type { Meta, StoryObj } from '@storybook/react-vite'
import { YourWorkPanel } from './YourWorkPanel'
import { DASHBOARD, WorkItem as WorkItemSchema } from '../fixtures/dashboard'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof YourWorkPanel> = {
  title: 'Signature/YourWorkPanel',
  component: YourWorkPanel,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof YourWorkPanel>

/** The fixture — one item, needing you. */
export const Default: Story = {
  args: { work: DASHBOARD.work, user: DASHBOARD.user },
}

/** Nothing on your plate. The panel keeps its rail, title and counter. */
export const EmptyInbox: Story = {
  name: 'Empty · nothing to do',
  args: {
    work: { needYou: 0, newCount: 0, total: 0, items: [] },
    user: DASHBOARD.user,
  },
}

/**
 * Ten items, with mixed "Your move" states. Row heights hold and the trailing
 * timestamp never overlaps the leading title.
 */
export const BusyInbox: Story = {
  args: {
    work: {
      needYou: 6,
      newCount: 3,
      total: 10,
      items: Array.from({ length: 10 }, (_, i) =>
        WorkItemSchema.parse({
          id: `w${i + 1}`,
          title:
            i % 3 === 0
              ? 'perf: avoid double-serialise in snapshot writer'
              : 'fix: guard against duplicate-id responses in WebSocket handler',
          repo: i % 2 === 0 ? 'XRPLF/xrpl-py' : 'openai/codex',
          number: 1000 + i,
          updated: new Date(Date.UTC(2026, 9, 28 - i, 7, 14)).toISOString(),
          yourMove: i % 2 === 0,
          note: i === 0 ? 'Branch is behind main' : undefined,
          openedByYou: i < 3,
        }),
      ),
    },
    user: DASHBOARD.user,
  },
}

export const ThreeIdentitiesStory: Story = {
  name: 'Three identities',
  render: () => (
    <ThreeIdentities
      render={() => <YourWorkPanel work={DASHBOARD.work} user={DASHBOARD.user} />}
      minWidth={380}
    />
  ),
}
