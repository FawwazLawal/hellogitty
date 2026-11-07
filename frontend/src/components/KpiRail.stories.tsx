import type { Meta, StoryObj } from '@storybook/react-vite'
import { KpiRail } from './KpiRail'
import { DASHBOARD, KpiTile as KpiTileSchema, type KpiTile } from '../fixtures/dashboard'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof KpiRail> = {
  title: 'Signature/KpiRail',
  component: KpiRail,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof KpiRail>

/** Fixture, straight from DASHBOARD.kpis — the four tiles from the reference render. */
export const Default: Story = {
  args: { tiles: DASHBOARD.kpis },
}

/**
 * The gap-finder view. Vermilion has maple + oni cut; azure and bone have no
 * tile illustrations and must degrade cleanly. Side-by-side makes the gap
 * self-evident without flipping through the toolbar.
 */
export const ThreeIdentitiesStory: Story = {
  name: 'Three identities (gap view)',
  render: () => (
    <ThreeIdentities render={() => <KpiRail tiles={DASHBOARD.kpis} />} minWidth={360} />
  ),
}

/**
 * A quiet start-of-day state: all four KPIs at zero. Numeric layout survives
 * single-digit values without the label column collapsing.
 */
export const Zeroed: Story = {
  args: {
    tiles: DASHBOARD.kpis.map((t) => KpiTileSchema.parse({ ...t, value: 0 })) as KpiTile[],
  },
}

/**
 * Five-digit values test the tabular numeral column against the trailing art.
 * The contrast comment on KpiRail covers this overlap case, but it is good to
 * actually see one.
 */
export const BigNumbers: Story = {
  args: {
    tiles: DASHBOARD.kpis.map((t) =>
      KpiTileSchema.parse({ ...t, value: t.id === 'api' ? 49999 : 9999 }),
    ) as KpiTile[],
  },
}
