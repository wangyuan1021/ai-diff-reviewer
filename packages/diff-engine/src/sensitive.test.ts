import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './parser'
import { redactParsedDiff, redactSensitiveText } from './sensitive'

describe('sensitive data redaction', () => {
  it('replaces common credential and identifier forms without echoing values', () => {
    const input = [
      'password = "fictional-password-123"',
      'Authorization: Bearer exampletoken123456789',
      'postgres://demo:fictional-pass@db.example.test/app',
      'owner@example.test 10.20.30.40',
    ].join('\n')

    const result = redactSensitiveText(input)

    expect(result.value).not.toContain('fictional-password-123')
    expect(result.value).not.toContain('exampletoken123456789')
    expect(result.value).not.toContain('demo:fictional-pass')
    expect(result.value).not.toContain('owner@example.test')
    expect(result.value).not.toContain('10.20.30.40')
    expect(new Set(result.findings.map((item) => item.kind))).toEqual(
      new Set([
        'credential',
        'authorization-token',
        'connection-string',
        'email-address',
        'private-ip-address',
      ]),
    )
  })

  it('redacts common provider token formats', () => {
    const result = redactSensitiveText(
      [
        'ghp_abcdefghijklmnopqrstuvwxyz123456',
        'xoxb-1234567890-fictional-token',
        'eyJmaWN0aW9uYWw.aGVhZGVyMTIz.c2lnbmF0dXJlMTIz',
      ].join('\n'),
    )

    expect(result.value).not.toContain('ghp_')
    expect(result.value).not.toContain('xoxb-')
    expect(result.value).not.toContain('eyJmaWN0aW9uYWw')
    expect(result.findings.map((item) => item.kind)).toEqual([
      'authorization-token',
      'authorization-token',
      'authorization-token',
    ])
  })

  it('does not flag environment templates or count existing placeholders again', () => {
    const template = redactSensitiveText('const token = "${TOKEN}"')
    const environment = redactSensitiveText('const password = process.env.PASSWORD')
    const placeholder = redactSensitiveText('password = "[REDACTED:CREDENTIAL]"')

    expect(template.findings).toHaveLength(0)
    expect(environment.findings).toHaveLength(0)
    expect(placeholder.findings).toHaveLength(0)
  })

  it('redacts multiline private keys while preserving diff line numbers', () => {
    const parsed = parseUnifiedDiff(`diff --git a/fixtures/key.pem b/fixtures/key.pem
new file mode 100644
--- /dev/null
+++ b/fixtures/key.pem
@@ -0,0 +1,3 @@
+-----BEGIN PRIVATE KEY-----
+ZmFrZS1ldmFsdWF0aW9uLW9ubHk=
+-----END PRIVATE KEY-----
`)

    const result = redactParsedDiff(parsed)
    const lines = result.parsed.files[0]?.hunks[0]?.lines ?? []

    expect(result.summary).toEqual({ findings: 1, types: ['private-key'] })
    expect(lines.map((line) => line.newLine)).toEqual([1, 2, 3])
    expect(lines.every((line) => line.content === '[REDACTED:PRIVATE_KEY]')).toBe(true)
  })

  it('redacts sensitive text in hunk context headers', () => {
    const parsed = parseUnifiedDiff(`diff --git a/src/demo.ts b/src/demo.ts
--- a/src/demo.ts
+++ b/src/demo.ts
@@ -1 +1,2 @@ owner@example.test
 export const value = 1
+export const next = 2
`)

    const result = redactParsedDiff(parsed)

    expect(result.parsed.files[0]?.hunks[0]?.header).not.toContain('owner@example.test')
    expect(result.parsed.files[0]?.hunks[0]?.header).toContain('[REDACTED:EMAIL]')
    expect(result.summary.types).toContain('email-address')
  })
})
