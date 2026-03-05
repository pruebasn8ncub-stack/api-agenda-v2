import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Get time parts from a Date in a given timezone.
 * Returns { time: "HH:MM:SS", dayIndex: 0-6 (Sun=0) }
 */
export function getTimeParts(date: Date, timezone: string): { time: string; dayIndex: number } {
    const zonedDate = toZonedTime(date, timezone);
    const hours = String(zonedDate.getHours()).padStart(2, '0');
    const minutes = String(zonedDate.getMinutes()).padStart(2, '0');
    const seconds = String(zonedDate.getSeconds()).padStart(2, '0');

    return {
        time: `${hours}:${minutes}:${seconds}`,
        dayIndex: zonedDate.getDay(),
    };
}

/**
 * Create a Date for a given date string (YYYY-MM-DD) and time (HH:MM) in the clinic timezone.
 */
export function createZonedDate(dateStr: string, time: string, timezone: string): Date {
    const localDateStr = `${dateStr}T${time}:00`;
    return fromZonedTime(localDateStr, timezone);
}

/**
 * Format a Date to HH:MM in the given timezone.
 */
export function formatTimeInZone(date: Date, timezone: string): string {
    const zonedDate = toZonedTime(date, timezone);
    const hours = String(zonedDate.getHours()).padStart(2, '0');
    const minutes = String(zonedDate.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Get the local hour from a Date in the given timezone.
 */
export function getLocalHour(date: Date, timezone: string): number {
    const zonedDate = toZonedTime(date, timezone);
    return zonedDate.getHours();
}
