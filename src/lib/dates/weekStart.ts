export function getNextWeekStartDateIso(now: Date = new Date()): string {
  // Next Monday in UTC, matching supplier capacity settings logic.
  const day = now.getUTCDay(); // 0..6 (Sun..Sat)
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  const nextMonday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilNextMonday,
    ),
  );
  return nextMonday.toISOString().slice(0, 10);
}

