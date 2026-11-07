import type { Meta, StoryObj } from '@storybook/react-vite'
import { Masthead } from './Masthead'
import { DASHBOARD, DashboardData as DashboardSchema } from '../fixtures/dashboard'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof Masthead> = {
  title: 'Signature/Masthead',
  component: Masthead,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Masthead>

/** The whole masthead against the real fixture — clock, brand, controls, scene. */
export const Default: Story = {
  args: { data: DASHBOARD },
}

/**
 * Three identities side by side.
 *
 * This is the story that would have caught the "Azure and Bone have no
 * mascot" gap before anyone had to click. The header scene differs between
 * identities on purpose; what must not differ is the clock / brand / control
 * hierarchy.
 */
export const ThreeIdentitiesStory: Story = {
  name: 'Three identities',
  render: () => (
    <ThreeIdentities render={() => <Masthead data={DASHBOARD} />} minWidth={420} />
  ),
}

/**
 * A long version string and a long codename — the brand row must not push the
 * clock out of its slot.
 */
export const LongBrandRow: Story = {
  args: {
    data: DashboardSchema.parse({
      ...DASHBOARD,
      version: 'v2.4.1-rc.12 (build 1874)',
      codename: 'A Codename That Is Significantly Longer Than Usual',
    }),
  },
}

/**
 * Midnight reading of the clock — exercises the "AM" meridiem rendering and the
 * leading zero logic for both minutes and seconds.
 */
export const MidnightClock: Story = {
  args: {
    data: DashboardSchema.parse({ ...DASHBOARD, generatedAt: '2026-11-06T00:00:00Z' }),
  },
}
