export const DIVISI_ORDER = ['DELICA', 'BAKERY', 'PRODUCE'] as const;
export type Divisi = (typeof DIVISI_ORDER)[number];

const PRODUCE_COUNTERS = new Set(['CUT FRUIT', 'JUICE']);

export function counterToDivisi(counter: string): Divisi {
  const c = String(counter || '').trim().toUpperCase();
  if (c === 'BAKERY') return 'BAKERY';
  if (PRODUCE_COUNTERS.has(c)) return 'PRODUCE';
  return 'DELICA';
}

export function sortNamesByDivisi(entries: { divisi: string; nama: string }[]): string {
  const rank = (d: string) => {
    const i = DIVISI_ORDER.indexOf(String(d || '').toUpperCase() as Divisi);
    return i === -1 ? 99 : i;
  };
  return entries
    .filter((e) => e.nama)
    .sort((a, b) => rank(a.divisi) - rank(b.divisi))
    .map((e) => e.nama)
    .join(' / ');
}
