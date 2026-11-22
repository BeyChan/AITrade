/**
 * 跨境站点本地时间、购物时段与年度大促/海运备货倒计时计算
 */

export type MarketTimezoneConfig = {
  code: string;
  cityLabel: string;
  timeZone: string;
  note: string;
};

export const MARKET_TIMEZONES: Record<string, MarketTimezoneConfig> = {
  US: { code: "US", cityLabel: "美西", timeZone: "America/Los_Angeles", note: "Amazon 美国站结算基准时区" },
  CA: { code: "CA", cityLabel: "多伦多", timeZone: "America/Toronto", note: "加拿大东部时间" },
  UK: { code: "UK", cityLabel: "伦敦", timeZone: "Europe/London", note: "英国站点当地时间" },
  GB: { code: "GB", cityLabel: "伦敦", timeZone: "Europe/London", note: "英国站点当地时间" },
  DE: { code: "DE", cityLabel: "柏林", timeZone: "Europe/Berlin", note: "欧洲中欧时间" },
  FR: { code: "FR", cityLabel: "巴黎", timeZone: "Europe/Paris", note: "欧洲中欧时间" },
  IT: { code: "IT", cityLabel: "罗马", timeZone: "Europe/Rome", note: "欧洲中欧时间" },
  ES: { code: "ES", cityLabel: "马德里", timeZone: "Europe/Madrid", note: "欧洲中欧时间" },
  AU: { code: "AU", cityLabel: "悉尼", timeZone: "Australia/Sydney", note: "澳大利亚东部时间" },
  JP: { code: "JP", cityLabel: "东京", timeZone: "Asia/Tokyo", note: "日本标准时间" },
  SG: { code: "SG", cityLabel: "新加坡", timeZone: "Asia/Singapore", note: "新加坡标准时间" },
  MY: { code: "MY", cityLabel: "吉隆坡", timeZone: "Asia/Kuala_Lumpur", note: "马来西亚标准时间" },
};

export type ShoppingWindowTone = "peak" | "active" | "muted" | "warn";

export type MarketClockSnapshot = {
  marketCode: string;
  cityLabel: string;
  timeZone: string;
  note: string;
  timeText: string; // HH:mm (24h)
  time12Text: string; // h:mm AM/PM (12h)
  dayPeriod: "AM" | "PM";
  dateText: string; // MM-DD 周X
  tzAbbr: string;
  hour: number;
  windowLabel: string;
  windowTone: ShoppingWindowTone;
  beijingTimeText: string;
  offsetDiffText: string;
};

export type UpcomingMilestone = {
  name: string;
  dateText: string; // YYYY-MM-DD
  daysLeft: number;
  seaLeadDays: number;
  seaCutoffDaysLeft: number;
  shippingTip: string;
  urgency: "urgent" | "soon" | "normal";
};

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const h = lookup.hour === "24" ? 0 : Number(lookup.hour);
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    h,
    Number(lookup.minute),
    Number(lookup.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function getMarketClockSnapshot(marketCode: string, now: Date = new Date()): MarketClockSnapshot {
  const code = (marketCode || "US").trim().toUpperCase();
  const config = MARKET_TIMEZONES[code] ?? MARKET_TIMEZONES.US;

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: config.timeZone,
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hourNum = map.hour === "24" ? 0 : Number(map.hour ?? 0);
  const hh = String(hourNum).padStart(2, "0");
  const mm = map.minute ?? "00";
  const dayPeriod: "AM" | "PM" = hourNum >= 12 ? "PM" : "AM";
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
  const time12Text = `${hour12}:${mm} ${dayPeriod}`;

  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timeZone,
    timeZoneName: "short",
  }).formatToParts(now);
  const tzAbbr = tzParts.find((p) => p.type === "timeZoneName")?.value ?? "";

  let windowLabel = "午后平稳";
  let windowTone: ShoppingWindowTone = "active";
  if (hourNum >= 18 && hourNum <= 22) {
    windowLabel = "晚间购物高峰";
    windowTone = "peak";
  } else if (hourNum >= 23) {
    windowLabel = "临近零点结算";
    windowTone = "warn";
  } else if (hourNum < 7) {
    windowLabel = "深夜低谷";
    windowTone = "muted";
  } else if (hourNum < 12) {
    windowLabel = "上午起量";
    windowTone = "active";
  }

  const beijingParts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const bjMap = Object.fromEntries(beijingParts.map((p) => [p.type, p.value]));
  const bjHour = bjMap.hour === "24" ? "00" : bjMap.hour ?? "00";
  const beijingTimeText = `${bjHour}:${bjMap.minute ?? "00"}`;

  const marketOffset = getTimeZoneOffsetMinutes(now, config.timeZone);
  const bjOffset = getTimeZoneOffsetMinutes(now, "Asia/Shanghai");
  const diffHours = Number(((marketOffset - bjOffset) / 60).toFixed(1));
  let offsetDiffText = "与北京时间同步";
  if (diffHours < 0) {
    offsetDiffText = `比北京时间慢 ${Math.abs(diffHours)} 小时`;
  } else if (diffHours > 0) {
    offsetDiffText = `比北京时间快 ${diffHours} 小时`;
  }

  return {
    marketCode: code,
    cityLabel: config.cityLabel,
    timeZone: config.timeZone,
    note: config.note,
    timeText: `${hh}:${mm}`,
    time12Text,
    dayPeriod,
    dateText: `${map.month ?? "01"}-${map.day ?? "01"} ${map.weekday ?? ""}`.trim(),
    tzAbbr,
    hour: hourNum,
    windowLabel,
    windowTone,
    beijingTimeText,
    offsetDiffText,
  };
}

function getNthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number): Date {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const diff = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + diff + (nth - 1) * 7;
  return new Date(Date.UTC(year, monthIndex, day));
}

function formatUtcDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getYearlyMilestones(year: number, marketCode: string): Array<{ name: string; date: Date; seaLeadDays: number }> {
  const code = marketCode.toUpperCase();
  const seaLeadDays = code === "JP" || code === "SG" || code === "MY" ? 18 : code === "AU" ? 28 : 35;

  // 11 月第 4 个周四（感恩节）次日 = 黑五
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
  const blackFriday = new Date(thanksgiving.getTime() + 24 * 60 * 60 * 1000);
  // 5 月第 2 个周日 = 母亲节
  const mothersDay = getNthWeekdayOfMonth(year, 4, 0, 2);

  const list: Array<{ name: string; date: Date; seaLeadDays: number }> = [
    { name: "春季大促 (Spring Deal)", date: new Date(Date.UTC(year, 2, 25)), seaLeadDays },
    { name: "母亲节礼赠季", date: mothersDay, seaLeadDays },
    { name: "Prime Day 会员日", date: new Date(Date.UTC(year, 6, 15)), seaLeadDays },
    { name: "秋季大促 (PBDD)", date: new Date(Date.UTC(year, 9, 10)), seaLeadDays },
    { name: "黑五网一大促 (BFCM)", date: blackFriday, seaLeadDays },
    {
      name: code === "AU" || code === "UK" || code === "GB" ? "圣诞 / Boxing Day" : "圣诞旺季",
      date: new Date(Date.UTC(year, 11, 25)),
      seaLeadDays,
    },
  ];

  return list;
}

export function getUpcomingCrossBorderMilestone(
  marketCode: string,
  now: Date = new Date(),
): UpcomingMilestone {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const year = now.getUTCFullYear();
  const candidates = [
    ...getYearlyMilestones(year, marketCode),
    ...getYearlyMilestones(year + 1, marketCode),
  ];

  const upcoming =
    candidates
      .map((item) => ({
        ...item,
        daysLeft: Math.ceil((item.date.getTime() - todayUtc) / (24 * 60 * 60 * 1000)),
      }))
      .filter((item) => item.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? {
      name: "黑五网一大促 (BFCM)",
      date: new Date(Date.UTC(year, 10, 27)),
      seaLeadDays: 35,
      daysLeft: 30,
    };

  const seaCutoffDaysLeft = upcoming.daysLeft - upcoming.seaLeadDays;
  let shippingTip = `距海运截单约 ${seaCutoffDaysLeft} 天（按 ${upcoming.seaLeadDays} 天头程）`;
  let urgency: UpcomingMilestone["urgency"] = "normal";

  if (upcoming.daysLeft === 0) {
    shippingTip = "大促当天 · 重点盯广告预算与库存";
    urgency = "urgent";
  } else if (seaCutoffDaysLeft <= 0) {
    shippingTip = `海运备货窗已过（需 ${upcoming.seaLeadDays} 天）· 补货建议走空派`;
    urgency = "urgent";
  } else if (seaCutoffDaysLeft <= 14) {
    shippingTip = `海运备货最后 ${seaCutoffDaysLeft} 天 · 建议尽快锁仓`;
    urgency = "soon";
  }

  return {
    name: upcoming.name,
    dateText: formatUtcDate(upcoming.date),
    daysLeft: upcoming.daysLeft,
    seaLeadDays: upcoming.seaLeadDays,
    seaCutoffDaysLeft,
    shippingTip,
    urgency,
  };
}
