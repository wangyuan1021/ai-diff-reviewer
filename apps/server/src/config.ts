function toPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  port: toPositiveInteger(process.env.PORT, 3000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  maxDiffBytes: toPositiveInteger(process.env.MAX_DIFF_BYTES, 512 * 1024),
}
