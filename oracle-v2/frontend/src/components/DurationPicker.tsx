import { useEffect, useState } from 'react';

type DurationUnit = 'minutes' | 'hours';

interface DurationPickerProps {
  valueMs: number;
  onChange: (nextMs: number) => void;
  disabled?: boolean;
}

function split(ms: number): { value: number; unit: DurationUnit } {
  if (ms % (60 * 60 * 1000) === 0) {
    return { value: Math.max(1, ms / (60 * 60 * 1000)), unit: 'hours' };
  }
  return { value: Math.max(1, Math.round(ms / (60 * 1000))), unit: 'minutes' };
}

function toMs(value: number, unit: DurationUnit): number {
  return unit === 'hours' ? value * 60 * 60 * 1000 : value * 60 * 1000;
}

export function DurationPicker({ valueMs, onChange, disabled }: DurationPickerProps) {
  const initial = split(valueMs);
  const [value, setValue] = useState(initial.value);
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);

  useEffect(() => {
    const next = split(valueMs);
    setValue(next.value);
    setUnit(next.unit);
  }, [valueMs]);

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="number"
        min={1}
        step={1}
        value={value}
        onChange={(e) => {
          const nextValue = Math.max(1, Number(e.target.value) || 1);
          setValue(nextValue);
          onChange(toMs(nextValue, unit));
        }}
        disabled={disabled}
        style={{
          width: 90,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          padding: '8px 10px',
        }}
      />
      <select
        value={unit}
        onChange={(e) => {
          const nextUnit = e.target.value as DurationUnit;
          setUnit(nextUnit);
          onChange(toMs(value, nextUnit));
        }}
        disabled={disabled}
        style={{
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          padding: '8px 10px',
        }}
      >
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
      </select>
    </div>
  );
}
