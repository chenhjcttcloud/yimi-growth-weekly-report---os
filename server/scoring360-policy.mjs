export const defaultScoring360ConfigManagers = [
  { userId: "mock_manager", name: "Demo Manager" },
];

export function parseScoring360LaunchDays(value, legacyDay = 25) {
  const source = String(value || "").trim();
  const fallbackDay = Number.isInteger(Number(legacyDay)) && Number(legacyDay) >= 20
    ? Number(legacyDay)
    : 25;
  if (!source) return [fallbackDay];
  const days = source
    .split(/[,\n;]/)
    .map((item) => Number(String(item).trim()))
    .filter((day) => Number.isInteger(day) && day >= 20 && day <= 31);
  const uniqueDays = Array.from(new Set(days));
  return uniqueDays.length === 1 ? uniqueDays : [fallbackDay];
}

export function scoring360CycleForLaunchDate(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("invalid_scoring360_launch_date");
  }
  const localDate = shanghaiDateParts(date);
  const period = currentMonthPeriod(localDate);
  return {
    id: `${period.year}-${String(period.month).padStart(2, "0")}-360`,
    label: `${period.year}年${period.month}月协同360评分`,
    mode: "monthly",
    round: 1,
    startDate: `${period.year}-${String(period.month).padStart(2, "0")}-01`,
    endDate: `${period.year}-${String(period.month).padStart(2, "0")}-${String(period.daysInMonth).padStart(2, "0")}`,
    monthKey: `${period.year}-${String(period.month).padStart(2, "0")}`,
  };
}

export function isScoring360CycleForDate(cycle, dateLike) {
  if (!cycle?.id) return false;
  return cycle.id === scoring360CycleForLaunchDate(dateLike).id;
}

export function isScoring360ConfigManager(user, managers = defaultScoring360ConfigManagers) {
  const userId = String(user?.userId || user?.user_id || "").trim();
  const name = String(user?.name || user?.姓名 || "").trim();
  return managers.some((manager) => {
    const managerUserId = String(manager?.userId || manager?.user_id || "").trim();
    const managerName = String(manager?.name || manager?.姓名 || "").trim();
    return Boolean(
      managerUserId ? userId === managerUserId : (name && managerName && name === managerName),
    );
  });
}

export function normalizeScoring360Managers(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  return list
    .map((item) => {
      if (typeof item === "string") return { userId: item.trim(), name: "" };
      return {
        userId: String(item?.userId || item?.user_id || "").trim(),
        name: String(item?.name || item?.姓名 || "").trim(),
      };
    })
    .filter((item) => {
      const key = item.userId || item.name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function shanghaiDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function currentMonthPeriod(date) {
  const year = date.year;
  const month = date.month;
  return {
    year,
    month,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}
