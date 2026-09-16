import { join } from 'node:path'

/**
 * The fixture clips the guide's screenshots import (#483): where they live
 * and what each shows. A plain module — not a test file — so
 * `guide-screenshots.ts` can import it without registering
 * `guide-fixtures.ts`'s recording test into its own run.
 */
export const GUIDE_FIXTURES_DIR = join('e2e', 'guide-fixtures')

export const GUIDE_FIXTURE_CLIPS = [
  { file: 'interview.webm', label: 'Interview', hue: 200, seconds: 4 },
  { file: 'b-roll.webm', label: 'B-roll', hue: 35, seconds: 3 },
] as const
