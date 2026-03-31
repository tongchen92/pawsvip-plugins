/**
 * Integration tests for payroll SQL queries against real Supabase.
 * Uses the 2026-03-16 to 2026-03-29 pay period (stable historical data
 * from the grooming tip backfill — $469.20 in tips captured).
 *
 * Setup: copy test/.env.test.example to test/.env.test and fill in keys.
 * Run: yarn test:integration
 */

import { describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

// The first stable pay period after the grooming tip backfill
const START = '2026-03-16' // Monday
const END = '2026-03-29'   // Sunday (13 days later)

describe.skipIf(!supabase)(
  `payroll queries — ${START} to ${END}`,
  () => {
    describe('date math', () => {
      it('START is a Monday', () => {
        expect(new Date(START + 'T12:00:00').getDay()).toBe(1)
      })

      it('END is a Sunday 13 days later', () => {
        const start = new Date(START + 'T12:00:00')
        const end = new Date(END + 'T12:00:00')
        const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
        expect(diffDays).toBe(13)
        expect(end.getDay()).toBe(0)
      })
    })

    describe('gingr grooming tips', () => {
      it('returns rows with numeric tip_amount values', async () => {
        const { data, error } = await supabase!
          .from('gingr_transactions')
          .select('location_id, tip_amount')
          .gte('sale_date', START)
          .lte('sale_date', END)
          .eq('is_voided', false)
          .not('tip_amount', 'is', null)

        expect(error).toBeNull()
        expect(data).toBeDefined()
        expect(data!.length).toBeGreaterThan(0)

        for (const row of data!) {
          expect(typeof row.location_id).toBe('number')
          expect(typeof row.tip_amount).toBe('number')
          expect(row.tip_amount).toBeGreaterThanOrEqual(0)
        }
      })

      it('has at least one transaction with a tip > $0', async () => {
        const { data, error } = await supabase!
          .from('gingr_transactions')
          .select('tip_amount')
          .gte('sale_date', START)
          .lte('sale_date', END)
          .eq('is_voided', false)
          .gt('tip_amount', 0)

        expect(error).toBeNull()
        expect(data!.length).toBeGreaterThan(0)
      })

      it('contains data from Tukwila (location_id = 1)', async () => {
        const { data, error } = await supabase!
          .from('gingr_transactions')
          .select('location_id')
          .gte('sale_date', START)
          .lte('sale_date', END)
          .eq('is_voided', false)
          .eq('location_id', 1)

        expect(error).toBeNull()
        expect(data!.length).toBeGreaterThan(0)
      })
    })

    describe('clover credit card tips', () => {
      it('returns rows with numeric tip_amount_cents values', async () => {
        const { data, error } = await supabase!
          .from('clover_transactions')
          .select('location_id, tip_amount_cents')
          .gte('created_date', START)
          .lte('created_date', END)
          .eq('result', 'SUCCESS')

        expect(error).toBeNull()
        expect(data).toBeDefined()
        expect(data!.length).toBeGreaterThan(0)

        for (const row of data!) {
          expect(typeof row.location_id).toBe('number')
          expect(typeof row.tip_amount_cents).toBe('number')
          expect(row.tip_amount_cents).toBeGreaterThanOrEqual(0)
        }
      })

      it('covers all 3 locations', async () => {
        const { data, error } = await supabase!
          .from('clover_transactions')
          .select('location_id')
          .gte('created_date', START)
          .lte('created_date', END)
          .eq('result', 'SUCCESS')

        expect(error).toBeNull()
        const locationIds = new Set(data!.map((r) => r.location_id))
        expect(locationIds.has(1)).toBe(true) // Tukwila
        expect(locationIds.has(2)).toBe(true) // Ballard
        expect(locationIds.has(3)).toBe(true) // West Seattle
      })

      it('tip_amount_cents converts to reasonable dollar amounts (< $500 per transaction)', async () => {
        const { data, error } = await supabase!
          .from('clover_transactions')
          .select('tip_amount_cents')
          .gte('created_date', START)
          .lte('created_date', END)
          .eq('result', 'SUCCESS')
          .gt('tip_amount_cents', 0)

        expect(error).toBeNull()
        for (const row of data!) {
          const dollars = row.tip_amount_cents / 100
          expect(dollars).toBeLessThan(500)
        }
      })
    })
  },
)

describe.skipIf(supabase !== null)('payroll integration (skipped)', () => {
  it.skip('copy test/.env.test.example to test/.env.test to enable', () => {})
})
