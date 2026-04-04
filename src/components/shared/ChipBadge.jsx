'use client';

// Colour mapping and display labels for cross-cutting chip values.
// Chip values come from CHIP_VALUES in constants.js.
const CHIP_CONFIG = {
  high_impact: {
    label: 'High impact',
    className: 'bg-red-100 text-red-700',
  },
  urgent: {
    label: 'Urgent',
    className: 'bg-orange-100 text-orange-700',
  },
  blocks_others: {
    label: 'Blocks others',
    className: 'bg-purple-100 text-purple-700',
  },
  stress_relief: {
    label: 'Stress relief',
    className: 'bg-teal-100 text-teal-700',
  },
  only_i_can: {
    label: 'Only I can',
    className: 'bg-indigo-100 text-indigo-700',
  },
};

/**
 * ChipBadge — small coloured pill for a single task chip value.
 *
 * @param {{ chip: string }} props
 */
export default function ChipBadge({ chip }) {
  const config = CHIP_CONFIG[chip];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${config.className}`}
    >
      {config.label}
    </span>
  );
}
