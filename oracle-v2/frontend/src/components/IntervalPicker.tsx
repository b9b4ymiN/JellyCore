import { useEffect, useState } from 'react';

type Unit = 'minutes' | 'hours' | 'days';

interface IntervalPickerProps {
  valueMs: number;
  onChange: (nextMs: number) => void;
  disabled?: boolean;
}

function splitInterval(ms: number): { value: number; unit: Unit } {
  if (ms % (24 * 60 * 60 * 1000) === 0) {
    return { value: Math.max(1, ms / (24 * 60 * 60 * 1000)), unit: 'days' };
  }
  if (ms % (60 * 60 * 1000) === 0) {
    return { value: Math.max(1, ms / (60 * 60 * 1000)), unit: 'hours' };
  }
  return { value: Math.max(1, Math.round(ms / (60 * 1000))), unit: 'minutes' };
}

function toMs(value: number, unit: Unit): number {
  if (unit === 'days') return value * 24 * 60 * 60 * 1000;
  if (unit === 'hours') return value * 60 * 60 * 1000;
  return value * 60 * 1000;
}

export function IntervalPicker({ valueMs, onChange, disabled }: IntervalPickerProps) {
  const initial = splitInterval(valueMs);
  const [value, setValue] = useState(initial.value);
  const [unit, setUnit] = useState<Unit>(initial.unit);

  useEffect(() => {
    const next = splitInterval(valueMs);
    setValue(next.value);
    setUnit(next.unit);
  }, [valueMs]);

  function emit(nextValue: number, nextUnit: Unit): void {
    onChange(toMs(Math.max(1, nextValue), nextUnit));
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="number"
        min={1}
        step={1}
        value={value}
        onChange={(e) => {
          const nextValue = Number(e.target.value) || 1;
          setValue(nextValue);
          emit(nextValue, unit);
        }}
        disabled={disabled}
        style={{
          width: 96,
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
          const nextUnit = e.target.value as Unit;
          setUnit(nextUnit);
          emit(value, nextUnit);
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
        <option value="days">days</option>
      </select>
    </div>
  );
}
