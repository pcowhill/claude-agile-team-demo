import { createContext, useContext } from 'react'
import type { TimeFormat } from '../lib/timeFormat'

/**
 * The Time fields setting (#848), provided once near the root rather than
 * threaded as a prop: it reaches 40-odd seconds fields across every row
 * kind of the timeline, the Trim / Split / Cut windows and the visual
 * editors, most of them several components deep. Outside a provider —
 * a component test that renders one field — it is seconds, today's
 * behaviour.
 */
export const TimeFormatContext = createContext<TimeFormat>('seconds')

/** The time format the nearest provider says, seconds without one. */
export function useTimeFormat(): TimeFormat {
  return useContext(TimeFormatContext)
}
