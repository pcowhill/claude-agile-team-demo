/**
 * Type-ahead in a list (#949, the Font menu's in-page list): as in a
 * native select, typing a name's first letters moves to it.
 */

/**
 * The index of the first label, from `from` on and wrapping past the end,
 * that starts with `typed`, ignoring case; -1 when none does.
 */
export function typeaheadMatch(labels: readonly string[], typed: string, from: number): number {
  const wanted = typed.toLocaleLowerCase()
  for (let step = 0; step < labels.length; step++) {
    const index = (from + step) % labels.length
    if (labels[index].toLocaleLowerCase().startsWith(wanted)) return index
  }
  return -1
}
