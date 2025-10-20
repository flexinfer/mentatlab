export function cn(...classes: Array<string | false | null | undefined>): string {
  // Filter out falsy values and join with a single space.
  return classes.filter((c) => Boolean(c)).join(' ');
}