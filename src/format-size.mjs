const units = ["MB", "GB", "TB"];
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  if (bytes === 0) return "0 MB";
  let value = bytes / 1024 ** 2;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 0.01 ? "<0.01" : number.format(value)} ${units[unit]}`;
}
