"use strict";

function scheduleFor(hour, now) {
  if (
    typeof hour !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(hour) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  )
    return null;
  const [hours, minutes] = hour.split(":").map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  return scheduled;
}

function localDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** Once per local calendar day, after today's chosen time. */
function isDue({ enabled, hour, lastRun, now = new Date() } = {}) {
  if (enabled !== true) return false;
  const scheduled = scheduleFor(hour, now);
  if (!scheduled || now < scheduled) return false;
  const last = lastRun == null ? null : new Date(lastRun);
  // A future timestamp also suppresses duplicate runs after a clock correction.
  return (
    !last || !Number.isFinite(last.getTime()) || localDay(last) < localDay(now)
  );
}

/** Earliest opportunity: now if overdue, otherwise the next local scheduled time. */
function nextRun({ enabled, hour, lastRun, now = new Date() } = {}) {
  if (enabled !== true) return null;
  const scheduled = scheduleFor(hour, now);
  if (!scheduled) return null;
  if (isDue({ enabled, hour, lastRun, now })) return new Date(now);
  const last = lastRun == null ? null : new Date(lastRun);
  if (
    scheduled <= now ||
    (last && Number.isFinite(last.getTime()) && localDay(last) >= localDay(now))
  ) {
    // Move by calendar date, never by 24 hours: DST days may have 23/25 hours.
    const next =
      last && Number.isFinite(last.getTime()) && localDay(last) > localDay(now)
        ? new Date(last)
        : new Date(now);
    next.setDate(next.getDate() + 1);
    const [hours, minutes] = hour.split(":").map(Number);
    next.setHours(hours, minutes, 0, 0);
    return next;
  }
  return scheduled;
}

module.exports = { isDue, nextRun };
