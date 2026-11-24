/**
 * What the export dialog's size result must say about a file of `bytes`
 * against a Size limit of `limitBytes` (#726, #905), judged from its text.
 * Returns the problems found, or none when the sentence reads right:
 *
 * - **The side of the limit.** Under or at it: "Saved name: 0.6 MB (limit
 *   0.7 MB)." Over it: "Saved name: 0.78 MB — over the 0.76 MB limit."
 * - **Both figures are the bytes rounded to one shared precision**: the
 *   most decimals either figure shows, since trailing zeros drop. So "10 MB"
 *   can stand beside "10.04 MB", and "0.8 MB" cannot stand for a 0.763 MB
 *   limit beside "0.78 MB".
 * - **Over reads as over.** A file over its limit shows a figure larger
 *   than the limit's, never the same one or a smaller one.
 * - **Under keeps one decimal**, as the dialog has always stated it.
 *
 * Independent of the app's own formatting functions on purpose: it parses
 * what the user reads, and checks it against the byte counts.
 */
export function sizeResultProblems(text: string, bytes: number, limitBytes: number): string[] {
  const match = /Saved \S+: (\d+(?:\.\d+)?) MB (— over the|\(limit) (\d+(?:\.\d+)?) MB( limit\.|\)\.)/.exec(text)
  if (match === null) return [`not a size result: "${text}"`]
  const [, sizeText, connector, limitText] = match
  const over = bytes > limitBytes
  const problems: string[] = []
  if (over !== (connector === '— over the')) {
    problems.push(`${over ? 'over' : 'under'} the limit, but the sentence says "${connector}"`)
  }
  // The precision both figures share: the most decimals either shows, since
  // a figure drops its trailing zeros ("1 MB" beside "1.3 MB" is 1.0).
  const decimals = (figure: string) => figure.split('.')[1]?.length ?? 0
  const shared = Math.max(decimals(sizeText), decimals(limitText))
  // Half a unit in that last place, and a hair for floating point.
  const half = 0.5 * 10 ** -shared + 1e-9
  if (Math.abs(Number(sizeText) - bytes / 1_000_000) > half) {
    problems.push(`the size ${sizeText} MB is not ${bytes} B rounded to ${shared} decimals`)
  }
  if (Math.abs(Number(limitText) - limitBytes / 1_000_000) > half) {
    problems.push(`the limit ${limitText} MB is not ${limitBytes} B rounded to ${shared} decimals`)
  }
  if (over && !(Number(sizeText) > Number(limitText))) {
    problems.push(`over the limit, but ${sizeText} MB does not read as more than ${limitText} MB`)
  }
  if (!over && shared > 1) problems.push(`under the limit, but the figures have ${shared} decimals`)
  return problems
}
