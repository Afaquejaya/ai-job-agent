'use client';

import type { ReactNode } from 'react';
import { Button } from './form';

/**
 * Repeating-row editor for profile lists (experience, education, skills, ...). An empty list is
 * saved as null, which the profile shows as "Not provided".
 */
export function ListEditor<T>({
  items,
  onChange,
  newItem,
  addLabel,
  renderItem,
  max,
}: {
  items: T[] | null;
  onChange: (items: T[] | null) => void;
  newItem: () => T;
  addLabel: string;
  renderItem: (item: T, update: (changes: Partial<T>) => void) => ReactNode;
  max: number;
}) {
  const list = items ?? [];
  const setAt = (index: number, changes: Partial<T>) =>
    onChange(list.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  const removeAt = (index: number) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : null);
  };

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? <p className="text-sm text-zinc-500">Not provided.</p> : null}
      {list.map((item, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        >
          {renderItem(item, (changes) => setAt(index, changes))}
          <Button variant="danger" size="sm" className="self-end" onClick={() => removeAt(index)}>
            Remove
          </Button>
        </div>
      ))}
      {list.length < max ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => onChange([...list, newItem()])}
        >
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}
