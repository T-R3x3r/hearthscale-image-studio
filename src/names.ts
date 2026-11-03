import { nameOf } from './records';

/** The longest name, in characters, a picture's file takes from words. */
export const LONGEST = 40;

/** Words made a name for a file: only letters, digits, spaces, dashes and
 *  apostrophes, cut at the end of a word to at most LONGEST characters. */
export function shortName(words: string): string {
  const clean = words
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= LONGEST) return nameOf(clean);
  const end = clean.lastIndexOf(' ', LONGEST);
  return nameOf((end > 0 ? clean.slice(0, end) : clean.slice(0, LONGEST)).trim());
}

/** When a picture was made, as the start of its file's name, so the files
 *  sort by time: `2026-11-03 14.32`. */
export function stamp(time: number): string {
  const at = new Date(time);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}`;
}
