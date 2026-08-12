/** Formatting for quantities that are mostly absurd. */

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', ',': '˒', '-': '⁻',
};

export const group = (n: number): string => n.toLocaleString('en-US');

export function superscript(n: number): string {
  return group(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
}

export function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

/** 281474976710656 -> "281.47 trillion" */
export function scaleWord(n: number): string {
  const tiers: Array<[number, string]> = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ];
  for (const [size, word] of tiers) {
    if (n >= size) return `${(n / size).toFixed(2).replace(/\.?0+$/, '')} ${word}`;
  }
  return group(n);
}
