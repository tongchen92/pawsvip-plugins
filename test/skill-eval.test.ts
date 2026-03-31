/**
 * LLM-as-judge evaluation for all skills.
 * Uses Gemini Flash to score each skill on clarity, completeness, actionability.
 * Scores are printed for reference — test fails if any dimension scores < 3.
 *
 * Cost: ~$0.01 per run across all skills (Gemini Flash pricing).
 * Setup: GEMINI_API_KEY in test/.env.test
 * Run: yarn test:evals
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'

const SKILLS_DIR = resolve(process.cwd(), 'skills')
const RUN_EVALS = process.env.EVALS === '1'
const PASS_THRESHOLD = 3

interface SkillScore {
  clarity: number
  completeness: number
  actionability: number
  notes: string
}

async function judgeSkill(name: string, content: string): Promise<SkillScore> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `Rate this Claude Code skill prompt on 3 dimensions (score 1–5 each):

1. **Clarity** — Can an AI agent follow these instructions without ambiguity?
2. **Completeness** — Are all steps, constraints, and edge cases defined?
3. **Actionability** — Can the agent execute this and deliver a correct, concrete result?

Reply with JSON only (no markdown fences):
{"clarity": N, "completeness": N, "actionability": N, "notes": "one-line observation"}

Skill: ${name}
---
${content.slice(0, 4000)}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
  return JSON.parse(cleaned)
}

function getSkills() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      path: join(SKILLS_DIR, d.name, 'SKILL.md'),
    }))
    .filter((s) => existsSync(s.path))
    .map((s) => ({ ...s, content: readFileSync(s.path, 'utf-8') }))
}

describe.skipIf(!RUN_EVALS)(`skill quality eval — pass threshold: ${PASS_THRESHOLD}/5`, () => {
  const skills = getSkills()

  for (const skill of skills) {
    it(
      `${skill.name}: clarity, completeness, actionability ≥ ${PASS_THRESHOLD}`,
      async () => {
        const score = await judgeSkill(skill.name, skill.content)

        console.log(
          `\n[${skill.name}] clarity=${score.clarity} completeness=${score.completeness} actionability=${score.actionability}`,
        )
        console.log(`  → ${score.notes}`)

        expect(score.clarity, `clarity < ${PASS_THRESHOLD}`).toBeGreaterThanOrEqual(PASS_THRESHOLD)
        expect(score.completeness, `completeness < ${PASS_THRESHOLD}`).toBeGreaterThanOrEqual(PASS_THRESHOLD)
        expect(score.actionability, `actionability < ${PASS_THRESHOLD}`).toBeGreaterThanOrEqual(PASS_THRESHOLD)
      },
      30_000,
    )
  }
})

describe.skipIf(RUN_EVALS)('skill eval (skipped — set EVALS=1 to run)', () => {
  it.skip('run with: EVALS=1 yarn test:evals', () => {})
})
