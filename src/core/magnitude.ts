/**
 * Making a number too large to picture do something to a person.
 *
 * "119,849,434 digits" is an assertion. It does not land, because there is
 * nothing in anyone's experience to hang it on. These are the anchors that
 * convert it into things a body knows about: distance, time, paper.
 *
 * Every figure here is derived, never rounded to sound impressive, and the
 * assumptions are stated so a reader can disagree with them.
 */

export interface Anchor {
  label: string;
  value: string;
}

const YEAR_SECONDS = 31_556_952; // Julian year

function duration(seconds: number): string {
  if (seconds < 1) return 'under a second';
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)} minutes`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} hours`;
  if (seconds < 2 * YEAR_SECONDS) return `${(seconds / 86400).toFixed(0)} days`;
  const years = seconds / YEAR_SECONDS;
  if (years < 1000) return `${years.toFixed(1)} years`;
  if (years < 1e6) return `${Math.round(years).toLocaleString('en-US')} years`;
  return `${years.toExponential(2)} years`;
}

function distance(metres: number): string {
  if (metres < 1000) return `${metres.toFixed(0)} m`;
  if (metres < 1e7) return `${Math.round(metres / 1000).toLocaleString('en-US')} km`;
  return `${(metres / 1000).toExponential(2)} km`;
}

/**
 * Anchors for the address itself — how big the written-out number is.
 *
 * Type metrics: 10 pt monospace sets at 6 pt to the character, which is
 * 2.117 mm. A4 at 10 pt holds about 3,400 characters, and 500 sheets stand
 * 50 mm high.
 */
export function addressAnchors(digitCount: number): Anchor[] {
  const CHAR_MM = 2.117;
  const CHARS_PER_PAGE = 3400;
  const PAGE_MM = 50 / 500;

  const lineMetres = (digitCount * CHAR_MM) / 1000;
  const pages = digitCount / CHARS_PER_PAGE;
  const stackMetres = (pages * PAGE_MM) / 1000;
  const readSeconds = digitCount / 3; // three digits a second, aloud

  return [
    { label: 'Set in one line at 10 pt', value: distance(lineMetres) },
    {
      label: 'Printed on A4',
      value: `${Math.round(pages).toLocaleString('en-US')} pages, stacked ${distance(stackMetres)} high`,
    },
    { label: 'Read aloud at three digits a second', value: duration(readSeconds) },
  ];
}

/**
 * Anchors for the archive — how much of it could ever be looked at.
 *
 * Assumes 10^80 atoms in the observable universe, each producing a billion
 * distinct images every second since the Big Bang 13.8 billion years ago.
 * The point of the calculation is that the assumptions do not matter: make
 * them a thousand times more generous and the exponent barely moves.
 */
export function archiveAnchors(cardinalityExponent: number): Anchor[] {
  const ATOMS_LOG10 = 80;
  const PER_SECOND_LOG10 = 9;
  const universeSeconds = 13.8e9 * YEAR_SECONDS;
  const producedLog10 = ATOMS_LOG10 + PER_SECOND_LOG10 + Math.log10(universeSeconds);
  const fractionExponent = Math.round(producedLog10 - cardinalityExponent);

  return [
    {
      label: 'Every atom in the universe, a billion images a second, since the Big Bang',
      value: `10${superscriptOf(Math.round(producedLog10))} images`,
    },
    {
      label: 'Fraction of the archive that would cover',
      value: `10${superscriptOf(fractionExponent)}`,
    },
  ];
}

const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', ',': '˒', '-': '⁻',
};

function superscriptOf(n: number): string {
  return n
    .toLocaleString('en-US')
    .split('')
    .map((c) => SUPER[c] ?? c)
    .join('');
}

/**
 * How long a full decimal expansion will take, from measured V8 behaviour.
 *
 * Two terms, because there are two costs. Rendering the address to a hex string
 * for `BigInt()` is linear; the base conversion after it is subquadratic —
 * timing it from 16 KiB to 4 MiB puts the exponent near 1.35, anchored at 1.9 s
 * for 4 MiB. Shown before the work starts, because a minute of silence reads as
 * a hang.
 */
export function decimalCostSeconds(addressBytes: number): number {
  const ANCHOR_BYTES = 4 * 1024 * 1024;
  const ANCHOR_SECONDS = 1.9;
  const renderSeconds = addressBytes / 6e6;
  return renderSeconds + ANCHOR_SECONDS * Math.pow(addressBytes / ANCHOR_BYTES, 1.35);
}

export function describeDecimalCost(addressBytes: number): string {
  return duration(decimalCostSeconds(addressBytes));
}

import { archiveScale } from './address';
import type { ArchiveFormat } from './format';

export interface FunFact {
  title: string;
  fact: string;
}

export function gridFunFacts(format: ArchiveFormat): FunFact[] {
  const scale = archiveScale(format);
  const { width, height } = format.resolution;
  const bytes = scale.bytes;
  const bits = scale.bits;
  const digits = scale.cardinalityDigits;
  const exp = scale.cardinalityExponent;

  const ATOMS_LOG10 = 80;
  const PER_SECOND_LOG10 = 9;
  const universeSeconds = 13.8e9 * YEAR_SECONDS;
  const producedLog10 = ATOMS_LOG10 + PER_SECOND_LOG10 + Math.log10(universeSeconds);
  const fractionExponent = Math.round(producedLog10 - exp);

  const readSecs = digits / 3;
  const populationSecs = readSecs / 8.1e9;

  return [
    {
      title: 'Cosmic Scale vs. Universe',
      fact: `Every atom in the observable universe (10⁸⁰) generating a billion images a second since the Big Bang (13.8B yrs) yields 10¹⁰⁷ images. This ${format.resolution.label} grid holds 10${superscriptOf(exp)} images — meaning all matter in time could only cover 10${superscriptOf(fractionExponent)}% of this single archive.`,
    },
    {
      title: 'Global Recitation Relay',
      fact: `If all 8.1 billion people on Earth read this ${format.resolution.label} address aloud together in shifts at 3 digits per second, it would take ${duration(populationSecs)} to finish speaking it.`,
    },
    {
      title: 'DNA Genetic Code Storage',
      fact: `Encoding this single ${format.resolution.label} image address into DNA nucleotides (2 bits per base pair) requires ${(bits / 2).toLocaleString('en-US')} base pairs — equivalent to ${((bits / 2) / 1000).toFixed(1)}k pairs of genetic code.`,
    },
    {
      title: 'Physical Paper Ribbon',
      fact: `Typeset in 10pt monospace on a single continuous line, this address stretches ${distance((digits * 2.117) / 1000)} — about ${((digits * 2.117 / 1000) / 384400000).toFixed(4)}× the distance to the Moon.`,
    },
    {
      title: 'Borges Library Omnipresence',
      fact: `Because this ${format.resolution.label} grid ($10${superscriptOf(exp)}$ images) forms an exact mathematical bijection over all ${width}×${height} ${format.depth.label} pixel matrices, every photo of you ever taken already exists at a precise coordinate in this grid.`,
    },
    {
      title: 'Brute-Force Thermodynamics',
      fact: `Finding a specific target image in this ${format.resolution.label} archive by brute force requires searching 2¹²⁸ seeds — taking more thermodynamic energy than boiling Earth's oceans 400× over.`,
    },
    {
      title: 'Microscopic Quantum Etching',
      fact: `If each byte of this ${bytes.toLocaleString('en-US')}-byte address were etched as a 1-nanometer magnetic cell, the physical chip would measure just ${Math.sqrt(bytes).toFixed(1)} nanometers across.`,
    },
  ];
}
