import type { Meta, StoryObj } from '@storybook/react-vite'
import { TrackedRepos } from './TrackedRepos'
import { DASHBOARD, TrackedRepo as TrackedRepoSchema, type TrackedRepo } from '../fixtures/dashboard'
import { ThreeIdentities } from '../../.storybook/ThreeIdentities'

const meta: Meta<typeof TrackedRepos> = {
  title: 'Signature/TrackedRepos',
  component: TrackedRepos,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof TrackedRepos>

/** The five rows the reference render shows. */
export const Default: Story = {
  args: { repos: DASHBOARD.repos, totals: DASHBOARD.repoTotals },
}

/**
 * Zero rows. The empty state is the signature case Phase 2 wants captured; the
 * toolbar, legend and status pill should all still read cleanly even though the
 * table body collapses to a single empty-state cell.
 */
export const EmptyNoRepos: Story = {
  name: 'Empty · no repos',
  args: { repos: [], totals: { newCount: 0, repoCount: 0 } },
}

/**
 * Twenty rows, stress-testing the table layout and the fixed header row's
 * column widths. Derived by repeating the fixture through the zod schema so
 * every row round-trips the contract.
 */
export const ManyRows: Story = {
  args: {
    repos: Array.from({ length: 4 }, (_, k) =>
      DASHBOARD.repos.map((repo, i) =>
        TrackedRepoSchema.parse({
          ...repo,
          name: `${repo.name}-${k * DASHBOARD.repos.length + i + 1}`,
        }),
      ),
    ).flat() satisfies TrackedRepo[],
    totals: { newCount: 149, repoCount: 20 },
  },
}

/**
 * A single row that is fully fouled: dormant health, failed gate, no good-first
 * issues, far older last-commit. Exercises every status chip simultaneously.
 */
export const AllDormant: Story = {
  args: {
    repos: [
      TrackedRepoSchema.parse({
        ...DASHBOARD.repos[0],
        owner: 'archived',
        name: 'vintage-project',
        health: 'DORMANT',
        gate: 'FAIL',
        lastCommit: '2024-02-03T00:00:00Z',
        newCount: 0,
        stages: ['failed', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'],
      }),
    ],
    totals: { newCount: 0, repoCount: 1 },
  },
}

export const ThreeIdentitiesStory: Story = {
  name: 'Three identities',
  render: () => (
    <ThreeIdentities
      render={() => <TrackedRepos repos={DASHBOARD.repos} totals={DASHBOARD.repoTotals} />}
      minWidth={520}
    />
  ),
}
