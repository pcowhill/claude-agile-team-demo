import { formatTimeReadout } from '../lib/timeFormat'
import { useTimeFormat } from './timeFormatContext'

/**
 * A live preview time in a visual editor (#848's criterion 6): `12.50 s`,
 * or `0:12.500` with the Time fields setting on minutes and seconds, so the
 * readout matches the boxes beside it.
 */
export function TimeReadout({ seconds }: { seconds: number }) {
  return formatTimeReadout(seconds, useTimeFormat())
}
