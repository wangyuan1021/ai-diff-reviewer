import type {
  ParsedDiff,
  SensitiveDataFinding,
  SensitiveDataKind,
  SensitiveDataSummary,
} from '@ai-diff-reviewer/shared'

interface SensitivePattern {
  kind: SensitiveDataKind
  pattern: RegExp
  replacement: string | ((substring: string, ...args: string[]) => string)
}

const PLACEHOLDERS: Record<SensitiveDataKind, string> = {
  credential: '[REDACTED:CREDENTIAL]',
  'authorization-token': '[REDACTED:AUTH_TOKEN]',
  'private-key': '[REDACTED:PRIVATE_KEY]',
  'connection-string': '[REDACTED:CONNECTION_STRING]',
  'email-address': '[REDACTED:EMAIL]',
  'private-ip-address': '[REDACTED:PRIVATE_IP]',
}

const PATTERNS: SensitivePattern[] = [
  {
    kind: 'private-key',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: PLACEHOLDERS['private-key'],
  },
  {
    kind: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: PLACEHOLDERS['private-key'],
  },
  {
    kind: 'authorization-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `Bearer ${PLACEHOLDERS['authorization-token']}`,
  },
  {
    kind: 'authorization-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g,
    replacement: PLACEHOLDERS['authorization-token'],
  },
  {
    kind: 'authorization-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: PLACEHOLDERS['authorization-token'],
  },
  {
    kind: 'authorization-token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: PLACEHOLDERS['authorization-token'],
  },
  {
    kind: 'credential',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: PLACEHOLDERS.credential,
  },
  {
    kind: 'connection-string',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replacement: (_match, scheme: string) => `${scheme}${PLACEHOLDERS['connection-string']}@`,
  },
  {
    kind: 'credential',
    pattern:
      /((?:["']?\b(?:api[_-]?key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd)\b["']?)\s*[:=]\s*)(["'])([^"'\\\r\n${}]{6,})(["'])/gi,
    replacement: (_match, prefix: string, quote: string) =>
      `${prefix}${quote}${PLACEHOLDERS.credential}${quote}`,
  },
  {
    kind: 'credential',
    pattern:
      /((?:\b(?:api[_-]?key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd)\b)\s*[:=]\s*)([^\s,"'{};]{6,})/gi,
    replacement: (_match, prefix: string) => `${prefix}${PLACEHOLDERS.credential}`,
  },
  {
    kind: 'email-address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: PLACEHOLDERS['email-address'],
  },
  {
    kind: 'private-ip-address',
    pattern:
      /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g,
    replacement: PLACEHOLDERS['private-ip-address'],
  },
]

function finding(kind: SensitiveDataKind): SensitiveDataFinding {
  return { kind }
}

export function redactSensitiveText(input: string): {
  value: string
  findings: SensitiveDataFinding[]
} {
  const findings: SensitiveDataFinding[] = []
  let value = input

  for (const item of PATTERNS) {
    value = value.replace(item.pattern, (...args: [string, ...string[]]) => {
      if (
        args[0].includes('[REDACTED:') ||
        /(?:process|import\.meta)\.env\b|(?:Deno|Bun)\.env\b|getenv\s*\(/i.test(args[0])
      ) {
        return args[0]
      }
      findings.push(finding(item.kind))
      return typeof item.replacement === 'string' ? item.replacement : item.replacement(...args)
    })
  }

  return { value, findings }
}

export function summarizeSensitiveFindings(findings: SensitiveDataFinding[]): SensitiveDataSummary {
  return {
    findings: findings.length,
    types: [...new Set(findings.map((item) => item.kind))].sort(),
  }
}

export function redactParsedDiff(parsed: ParsedDiff): {
  parsed: ParsedDiff
  summary: SensitiveDataSummary
} {
  const findings: SensitiveDataFinding[] = []
  const files = parsed.files.map((file) => {
    let insidePrivateKey = false
    return {
      ...file,
      hunks: file.hunks.map((hunk) => {
        const redactedHeader = redactSensitiveText(hunk.header)
        findings.push(...redactedHeader.findings)
        return {
          ...hunk,
          header: redactedHeader.value,
          lines: hunk.lines.map((line) => {
            const startsPrivateKey = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(
              line.content,
            )
            const endsPrivateKey = /-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(
              line.content,
            )
            if (insidePrivateKey || startsPrivateKey) {
              if (startsPrivateKey && !insidePrivateKey) findings.push(finding('private-key'))
              insidePrivateKey = !endsPrivateKey
              return { ...line, content: PLACEHOLDERS['private-key'] }
            }

            const redacted = redactSensitiveText(line.content)
            findings.push(...redacted.findings)
            return { ...line, content: redacted.value }
          }),
        }
      }),
    }
  })

  return {
    parsed: { ...parsed, files },
    summary: summarizeSensitiveFindings(findings),
  }
}
