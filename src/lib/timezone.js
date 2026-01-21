export const LONDON_TIME_ZONE = 'Europe/London';

export function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const record = {};
  for (const part of parts) {
    if (part.type === 'year') record.year = Number(part.value);
    if (part.type === 'month') record.month = Number(part.value);
    if (part.type === 'day') record.day = Number(part.value);
    if (part.type === 'hour') record.hour = Number(part.value);
    if (part.type === 'minute') record.minute = Number(part.value);
  }

  if (
    Number.isNaN(record.year) ||
    Number.isNaN(record.month) ||
    Number.isNaN(record.day) ||
    Number.isNaN(record.hour) ||
    Number.isNaN(record.minute)
  ) {
    throw new Error(`Unable to derive time parts for timezone ${timeZone}`);
  }

  return {
    ...record,
    dateKey: `${String(record.year).padStart(4, '0')}-${String(record.month).padStart(2, '0')}-${String(record.day).padStart(2, '0')}`,
  };
}

export function getLondonDateKey(date = new Date()) {
  return getTimeZoneParts(date, LONDON_TIME_ZONE).dateKey;
}

export function isLondonTimeWindow({ date = new Date(), hour, minute, windowMinutes = 0 }) {
  const parts = getTimeZoneParts(date, LONDON_TIME_ZONE);
  if (parts.hour !== hour) return false;

  if (!windowMinutes || windowMinutes <= 0) {
    return parts.minute === minute;
  }

  return parts.minute >= minute && parts.minute < (minute + windowMinutes);
}

