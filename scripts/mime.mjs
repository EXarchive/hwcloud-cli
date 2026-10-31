/**
 * mime.mjs —— 构造 RFC 5322 邮件报文（纯函数，便于单测）
 *
 * 支持：
 *   - 纯文本与 HTML 双正文（multipart/alternative）
 *   - 中文标题/收件人名的 RFC 2047 编码
 *   - 长行折叠（header folding）
 *   - 附件（base64，multipart/mixed）
 */

export function encodeHeaderValue(value) {
  // 含非 ASCII 时按 RFC 2047 Base64 编码，避免中文标题在部分客户端乱码
  if (!/[^\x20-\x7E]/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

export function foldHeader(name, value, limit = 76) {
  const head = `${name}: `
  const words = String(value).split(/\s+/)
  const lines = []
  let line = head
  for (const word of words) {
    if (line.length + word.length + 1 > limit && line !== head) {
      lines.push(line)
      line = ` ${word}`
    } else {
      line += (line === head ? '' : ' ') + word
    }
  }
  lines.push(line)
  return lines.join('\r\n')
}

export function addressList(list) {
  const items = Array.isArray(list) ? list : String(list).split(',')
  return items
    .map((item) => {
      const value = String(item).trim()
      if (!value) return ''
      const m = value.match(/^(.*)<(.+)>$/)
      if (m) {
        const name = m[1].trim().replace(/^"|"$/g, '')
        return `${encodeHeaderValue(name)} <${m[2].trim()}>`
      }
      return value
    })
    .filter(Boolean)
    .join(', ')
}

export function buildMessage({
  from,
  to,
  cc,
  subject,
  text,
  html,
  attachments = [],
  date = new Date(),
  messageId,
}) {
  const boundaryMixed = `mix-${randomId()}`
  const boundaryAlt = `alt-${randomId()}`
  const hasAttachments = attachments.length > 0

  const headers = [
    foldHeader('From', addressList(from)),
    foldHeader('To', addressList(to)),
    cc ? foldHeader('Cc', addressList(cc)) : null,
    foldHeader('Subject', encodeHeaderValue(subject)),
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId ?? `${randomId()}@mail.local`}>`,
    'MIME-Version: 1.0',
    hasAttachments
      ? `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`
      : `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
  ].filter(Boolean)

  const altPart = [
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text ?? '', 'utf8').toString('base64')),
    `--${boundaryAlt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html ?? text ?? '', 'utf8').toString('base64')),
    `--${boundaryAlt}--`,
  ]

  let body
  if (hasAttachments) {
    const parts = [
      `--${boundaryMixed}`,
      `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
      '',
      ...altPart,
    ]
    for (const att of attachments) {
      parts.push(
        `--${boundaryMixed}`,
        `Content-Type: ${att.contentType ?? 'application/octet-stream'}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${encodeHeaderValue(att.filename)}"`,
        '',
        wrap76(Buffer.from(att.content ?? '').toString('base64')),
      )
    }
    parts.push(`--${boundaryMixed}--`)
    body = parts
  } else {
    body = altPart
  }

  return headers.join('\r\n') + '\r\n\r\n' + body.join('\r\n') + '\r\n'
}

export function wrap76(base64) {
  return base64.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '')
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
