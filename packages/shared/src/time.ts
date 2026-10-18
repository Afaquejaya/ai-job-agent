import { z } from 'zod';

/** ISO-8601 timestamp in UTC (must end in `Z`). All stored and transmitted timestamps use UTC. */
export const isoTimestampSchema = z.iso.datetime({ offset: false });

/** True if `timeZone` is an IANA time zone the runtime understands, e.g. `Asia/Kolkata`. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A user's configured time zone. Daily limits are calculated in this zone. */
export const timeZoneSchema = z.string().min(1).refine(isValidTimeZone, {
  message: 'Unknown IANA time zone',
});
