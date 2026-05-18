import dayjs from "dayjs";

export function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(
  iso: string | null,
  format = "YYYY-MM-DD HH:mm"
): string {
  if (!iso) return "—";
  return dayjs(iso).format(format);
}

