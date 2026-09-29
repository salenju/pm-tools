const MS_PER_DAY = 86400000

export function nowIso() {
  return new Date().toISOString()
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 本地时间 "YYYY-MM-DD HH:mm"。 */
export function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** 本地日期 "YYYY-MM-DD"。 */
export function formatDay(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今天的本地日期字符串，用于 date 输入框默认值。 */
export function todayString(date = new Date()) {
  return formatDay(date)
}

/**
 * 距今经过的天数（向下取整）。
 * @param {string} iso
 */
export function daysSince(iso, nowMs = Date.now()) {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / MS_PER_DAY))
}

/** 相对时间，如 "刚刚" / "12 分钟前" / "3 小时前" / "2 天前"。 */
export function relativeTime(iso, nowMs = Date.now()) {
  if (!iso) return '从未'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '未知'
  const diff = Math.max(0, nowMs - t)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 判断日期字符串是否 <= 今天（用于"下次跟进到期"）。 */
export function isDueTodayOrEarlier(value, nowMs = Date.now()) {
  if (!value) return false
  const t = new Date(`${value}T23:59:59`).getTime()
  if (Number.isNaN(t)) return false
  return t <= nowMs
}
