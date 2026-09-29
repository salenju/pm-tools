const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * 生成随机小写字母数字串。
 * @param {number} [length]
 */
export function randomId(length = 6) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

/** 本地日期戳 YYYYMMDD。 */
export function dateStamp(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * PRD 6.5：项目与客户由多端各自生成，**不得使用自增序号**（跨设备必然碰撞）。
 */
export function newProjectId(date = new Date()) {
  return `prj_${dateStamp(date)}_${randomId(6)}`
}

export function newCustomerId() {
  return `cus_${randomId(6)}`
}

/**
 * 节点 / 字段 ID：位于 config.json 内，只有管理员写入，可安全使用序号。
 * 取现有最大序号 + 1。
 * @param {string} prefix 如 'n' 或 'f'
 * @param {string[]} existingIds
 */
export function nextSeqId(prefix, existingIds) {
  let max = 0
  const re = new RegExp(`^${prefix}(\\d+)$`)
  for (const id of existingIds) {
    const m = re.exec(String(id))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${max + 1}`
}

/** 从模板中收集全部字段 ID（用于生成不重复的新字段 ID）。 */
export function collectFieldIds(nodes = []) {
  const ids = []
  for (const node of nodes) {
    for (const field of node.fields || []) ids.push(field.id)
  }
  return ids
}
