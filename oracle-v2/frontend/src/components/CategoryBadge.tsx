export type SchedulerCategory = 'learning' | 'monitor' | 'health' | 'custom';

interface CategoryBadgeProps {
  category: SchedulerCategory;
}

const categoryMeta: Record<SchedulerCategory, { emoji: string; label: string; color: string }> = {
  learning: { emoji: '📚', label: 'learning', color: '#38bdf8' },
  monitor: { emoji: '📊', label: 'monitor', color: '#f59e0b' },
  health: { emoji: '🏥', label: 'health', color: '#22c55e' },
  custom: { emoji: '🔧', label: 'custom', color: '#a78bfa' },
};

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const value = categoryMeta[category];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        border: `1px solid ${value.color}55`,
        background: `${value.color}22`,
        color: value.color,
        padding: '2px 8px',
        fontSize: 12,
      }}
    >
      <span>{value.emoji}</span>
      <span>{value.label}</span>
    </span>
  );
}
