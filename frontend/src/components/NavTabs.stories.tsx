import type { Meta, StoryObj } from '@storybook/react-vite'
import { NavTabs } from './NavTabs'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof NavTabs> = {
  title: 'Signature/NavTabs',
  component: NavTabs,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof NavTabs>

/**
 * NavTabs owns its own selected tab state. Click any tab to exercise the
 * underline + bolded label; the aria-current attribute is also set so a
 * screen reader hears the active item independently of colour.
 */
export const Default: Story = {}

export const ThreeIdentitiesStory: Story = {
  name: 'Three identities',
  render: () => <ThreeIdentities render={() => <NavTabs />} minWidth={320} />,
}
