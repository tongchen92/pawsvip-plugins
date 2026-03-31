/**
 * Structural validation for all SKILL.md files.
 * Fast — no network calls, no API keys required.
 * Run: yarn test
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const SKILLS_DIR = resolve(process.cwd(), 'skills')

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    result[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim()
  }
  return result
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

describe('skill structure', () => {
  const skills = getSkills()

  it('finds at least one skill', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  for (const skill of skills) {
    describe(skill.name, () => {
      const fm = parseFrontmatter(skill.content)

      it('has valid frontmatter', () => {
        expect(fm, 'missing --- frontmatter block').not.toBeNull()
        expect(fm?.name, 'name field missing').toBeTruthy()
        expect(fm?.description, 'description field missing').toBeTruthy()
        expect(fm?.['user-invocable'], 'user-invocable field missing').toMatch(/^(true|false)$/)
      })

      it('has a non-empty body (>100 chars)', () => {
        const body = skill.content.replace(/^---[\s\S]*?---\n/, '')
        expect(body.trim().length).toBeGreaterThan(100)
      })

      if (parseFrontmatter(skill.content)?.['user-invocable'] === 'true') {
        it('explicitly asks the user for input before acting', () => {
          expect(skill.content.toLowerCase()).toMatch(/ask|prompt|provide|enter/)
        })
      }

      const sqlBlocks = [...skill.content.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1])
      if (sqlBlocks.length > 0) {
        it('uses <PLACEHOLDER> for dynamic values in SQL — no hardcoded dates', () => {
          for (const sql of sqlBlocks) {
            // Hardcoded dates like '2026-03-16' should not appear — use <START_DATE> etc.
            expect(sql, `hardcoded date found in SQL block`).not.toMatch(/'20\d{2}-\d{2}-\d{2}'/)
          }
        })
      }
    })
  }
})

describe('payroll-data skill', () => {
  const skillPath = join(SKILLS_DIR, 'payroll-data', 'SKILL.md')

  it('skill file exists', () => {
    expect(existsSync(skillPath)).toBe(true)
  })

  const content = existsSync(skillPath) ? readFileSync(skillPath, 'utf-8') : ''

  it('validates Monday requirement', () => {
    expect(content.toLowerCase()).toMatch(/monday/)
  })

  it('defines a 2-week pay period (13 days span or 2 weeks)', () => {
    expect(content).toMatch(/13 days|2 full weeks|2-week/)
  })

  it('queries gingr_transactions for grooming tips', () => {
    expect(content).toMatch(/gingr_transactions/)
    expect(content).toMatch(/tip_amount/)
  })

  it('joins reservation table to attribute tips to groomers', () => {
    expect(content).toMatch(/reservation/)
    expect(content).toMatch(/services_assigned_to/)
    expect(content).toMatch(/transaction_pos_transaction_id/)
  })

  it('deduplicates multi-pet transactions to avoid double-counting', () => {
    // Must use DISTINCT or equivalent to handle same groomer, multiple pets
    expect(content).toMatch(/DISTINCT/)
  })

  it('splits tips equally when multiple groomers share a transaction', () => {
    // Must divide by COUNT(*) OVER partition
    expect(content).toMatch(/COUNT\(\*\) OVER/)
  })

  it('queries clover_transactions for credit card tips', () => {
    expect(content).toMatch(/clover_transactions/)
    expect(content).toMatch(/tip_amount_cents/)
  })

  it('filters out voided gingr transactions', () => {
    expect(content).toMatch(/is_voided/)
  })

  it('filters clover by result = SUCCESS', () => {
    expect(content).toMatch(/SUCCESS/)
  })

  it('breaks results down by location', () => {
    expect(content).toMatch(/location_id/)
    expect(content).toMatch(/Tukwila/)
    expect(content).toMatch(/Ballard/)
    expect(content).toMatch(/West Seattle/)
  })

  it('converts clover cents to dollars in output', () => {
    // Clover stores cents — skill must divide by 100
    expect(content).toMatch(/100/)
  })
})
