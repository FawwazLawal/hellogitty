import type { Meta, StoryObj } from '@storybook/react-vite'
import { PipelinePanel } from './PipelinePanel'
import { DASHBOARD, Pipeline as PipelineSchema, STAGES } from '../fixtures/dashboard'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof PipelinePanel> = {
  title: 'Signature/PipelinePanel',
  component: PipelinePanel,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof PipelinePanel>

/** The fixture's pipeline, seven stage chips and the five-number bar. */
export const Default: Story = {
  args: { pipeline: DASHBOARD.pipeline },
}

/**
 * Nothing in flight anywhere. All counts zero; "Rate" degrades to 0% when
 * merged + closed is zero (division handled in the component).
 */
export const EmptyPipeline: Story = {
  args: {
    pipeline: PipelineSchema.parse({
      repoCount: 0,
      byStage: STAGES.map((stage) => ({ stage, count: 0 })),
      opened: 0,
      open: 0,
      merged: 0,
      closed: 0,
      ratePercent: 0,
      latest: '',
    }),
  },
}

/**
 * A pipeline weighted heavily to one stage — exercises chip sizing when a
 * single number is bigger than its neighbours.
 */
export const HotStage: Story = {
  args: {
    pipeline: PipelineSchema.parse({
      ...DASHBOARD.pipeline,
      byStage: STAGES.map((stage) =>
        stage === 'BLD' ? { stage, count: 420 } : { stage, count: 2 },
      ),
    }),
  },
}

/**
 * Collapsed is internal state (chevron toggles it). Kept as its own story so
 * the collapsed treatment can be screenshot-reviewed alongside the open one.
 */
export const Collapsible: Story = {
  args: { pipeline: DASHBOARD.pipeline },
  parameters: {
    docs: {
      description: {
        story: 'Click the chevron to collapse. State lives inside the component.',
      },
    },
  },
}

export const ThreeIdentitiesStory: Story = {
  name: 'Three identities',
  render: () => (
    <ThreeIdentities render={() => <PipelinePanel pipeline={DASHBOARD.pipeline} />} minWidth={360} />
  ),
}
