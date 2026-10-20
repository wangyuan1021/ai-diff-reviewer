import { z } from 'zod'

export const aiProviderNameSchema = z.enum(['mock', 'openai-compatible', 'ollama'])

export const aiRiskSchema = z
  .object({
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    category: z.enum([
      'correctness',
      'security',
      'performance',
      'compatibility',
      'maintainability',
      'testing',
      'configuration',
      'dependency',
    ]),
    title: z.string().trim().min(1).max(120),
    file: z.string().trim().min(1).max(500),
    line: z.number().int().positive(),
    evidence: z.string().trim().min(1).max(600),
    impact: z.string().trim().min(1).max(600),
    suggestion: z.string().trim().min(1).max(600),
  })
  .strict()

export const aiModelOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000),
    overallRisk: z.enum(['low', 'medium', 'high', 'critical']),
    confidence: z.number().min(0).max(1),
    risks: z.array(aiRiskSchema).max(20),
    testSuggestions: z.array(z.string().trim().min(1).max(400)).max(10),
    releaseChecklist: z.array(z.string().trim().min(1).max(400)).max(10),
  })
  .strict()
