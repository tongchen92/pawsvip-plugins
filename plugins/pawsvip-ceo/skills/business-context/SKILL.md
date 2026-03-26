---
name: pawsvip-business-context
description: PawsVIP pet hotel business context — locations, roles, schedules, gallery pipeline, and financial reconciliation. Use automatically when answering questions about PawsVIP operations.
user-invocable: false
---

# PawsVIP Business Context

You are assisting the CEO of PawsVIP, a pet hotel company with 3 locations in the Seattle area.

## Locations

There is NO `locations` table in the database. Location IDs are hardcoded:

| location_id | Name | Instagram |
|-------------|------|-----------|
| 1 | Tukwila | @pawsvip.tukwila |
| 2 | Ballard | @pawsvip.ballard |
| 3 | West Seattle | @pawsvip.westseattle |

When writing SQL that needs location names, use a CASE statement:
```sql
CASE location_id
  WHEN 1 THEN 'Tukwila'
  WHEN 2 THEN 'Ballard'
  WHEN 3 THEN 'West Seattle'
END AS location_name
```

## Roles

Staff roles in ascending order of permissions:
- **staff** — frontline workers (check-ins, gallery uploads, shift tasks)
- **lead** — shift leads (till counts, task oversight)
- **manager** — multi-location oversight
- **admin** — full access (scheduling, reconciliation, settings)

Stored in `pawsvip_staff.role` column.

## Schedule System

The schedule runs Monday through Sunday.

- `schedule_weeks` — one row per week. `status` is `'draft'` or `'published'`. Only published weeks are visible to staff.
- `schedule_shifts` — individual shift assignments. Each row is one person's shift on one day.
  - `staff_id IS NULL` means the shift is **unfilled** (needs coverage).
  - `is_lead = true` means this person is the shift lead.
  - `location_id` — which location the shift is at (added via migration, may be NULL on older records).

**Shift classification** (based on start_time):
- OPEN: 05:00 - 12:59
- CLOSE: 13:00 - 20:59
- OVERNIGHT: 21:00 - 04:59

**Overnight cutoff**: Before 5:00 AM PST, the "current day" is actually the previous calendar day. Overnight staff work the "previous day" until the 5 AM shift cutoff.

## Gallery Pipeline

The pet photo gallery flow:
1. Staff uploads photos/videos via PawsDrop → stored in `media_ingestion_ledger`
2. Photos are processed: YOLO dog detection → DINOv2 embedding → pgvector matching → auto-tagged with animal IDs
3. AI verification (Gemini Vision) checks photo quality → stored in `pet_gallery.ai_verification`
4. Approved photos become visible to customers on the pet parent portal
5. Gallery email notifications are scheduled and sent to pet owners (paced 30 min apart)
6. Customers can react (like) photos → stored in `gallery_reactions`

Key statuses for `pet_gallery.email_notification_status`:
- `pending` → `scheduled` → `processing` → `sent` (happy path)
- `failed`, `skipped`, `ai_rejected` (error/skip paths)

## Financial Reconciliation

Daily revenue matching between two systems:
- **Gingr** — reservation management (prices, services, check-in/out)
- **Clover** — point-of-sale / payment processing

The reconciliation compares Gingr daily totals vs Clover daily totals (minus tips). The difference is the "gap" — ideally near zero. Positive gap = over-collected, negative = under-collected.

Cash payments are filtered out (no Clover record for cash).

Revenue sources in Gingr: reservation prices, add-on services (grooming, medication), transaction gaps, manual adjustments.

## Response Style

**Be fast and direct.** When the CEO asks a question:
1. Write the SQL query immediately — do not explain what you're about to do
2. Execute it in one shot — do not look up project IDs or list tables first
3. Present the results in a clear table
4. Add a brief insight only if the data reveals something notable

Do NOT:
- Say "Let me load the data model" or "Let me find the project ID"
- Create todo lists or update task trackers
- Explain your reasoning before executing
- Run multiple exploratory queries — use the tested query patterns from the data-model skill

## Key Business Metrics

When the CEO asks about business performance, these are the most relevant metrics:
- **Occupancy** — use `forecast_historical_occupancy` (NEVER `reservation`)
- **Staffing coverage** — filled vs unfilled shifts
- **Gallery engagement** — photos shared, customer reactions received
- **Shift task completion** — percentage of tasks completed on time
- **Revenue** — daily/weekly by location (requires QuickBooks data)
- **New customers** — new customer_links records
- **Leads** — new leads by source and conversion status
