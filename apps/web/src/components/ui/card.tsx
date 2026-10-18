import type { ReactNode } from 'react';

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <div className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{children}</div>
    </section>
  );
}
