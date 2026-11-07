import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConversationsPanel } from './ConversationsPanel'
import { DASHBOARD } from '../fixtures/dashboard'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof ConversationsPanel> = {
  title: 'Signature/ConversationsPanel',
  component: ConversationsPanel,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof ConversationsPanel>

/** The fixture's quiet state — 14 quiet of 14 total. */
export const Default: Story = {
  args: { data: DASHBOARD.conversations },
}

/**
 * The all-zero empty state. Vermilion has /art/vermilion-empty.webp, azure
 * and bone have no cut; the panel degrades cleanly rather than borrowing the
 * red torii. That is exactly the gap this view is for.
 */
export const EmptyAllZero: Story = {
  name: 'Empty · zero conversations',
  args: { data: { quiet: 0, total: 0 } },
}

/** A busy inbox: everything is live, nothing quiet. */
export const Busy: Story = {
  args: { data: { quiet: 0, total: 42 } },
}

/**
 * Collapsed is driven by the panel's own internal state — click the chevron
 * to toggle. We keep this story because the collapsed treatment is a signature
 * surface in its own right.
 */
export const Collapsible: Story = {
  args: { data: DASHBOARD.conversations },
  parameters: {
    docs: {
      description: {
        story: 'Click the chevron to collapse. State lives inside the component.',
      },
    },
  },
}

export const ThreeIdentitiesStory: Story = {
  name: 'Three identities (gap view)',
  render: () => (
    <ThreeIdentities
      render={() => <ConversationsPanel data={DASHBOARD.conversations} />}
      minWidth={380}
    />
  ),
}
