export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const percent = (value: number, digits = 1) =>
  `${(value * 100).toFixed(digits)}%`;

export const compactNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export const shortDate = (value: string | Date) =>
  new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    typeof value === "string" ? new Date(value) : value,
  );
