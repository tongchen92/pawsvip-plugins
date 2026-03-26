---
name: pawsvip-gingr-patterns
description: Gingr API behavior, performance constraints, and data caching patterns for PawsVIP. Use when questions involve reservation data, customer lookups, or Gingr-sourced information.
user-invocable: false
---

# Gingr API Patterns

Gingr is the reservation management system. Most Gingr data is **cached in Supabase** — always query Supabase first, not the Gingr API directly.

## Key Constraints

- **GINGR_TIMEOUT_MS = 6,000** — any Gingr API call slower than 6 seconds silently returns null
- **`/api/v1/reservations`** — returns ALL reservations for a date range (~500 records, ~600KB, ~13 seconds per request). The `params[owner_id]` and `checked_in=true` parameters are **silently ignored** — there is no server-side owner filtering. All filtering must be done client-side.
- **`/api/v1/owners`** with `params[id]=<ownerId>` — fast (~300ms). Returns owner info including `last_reservation` and `next_reservation` directly. Use this for single-owner lookups.

## Data Freshness

Reservation data in Supabase is synced from Gingr via:
- **Webhooks** — real-time for check-in/check-out events
- **Hourly cron** (`sync-gingr-daily`) — bulk sync of reservation data

This means Supabase reservation data may be **up to 1 hour stale** for non-check-in/out changes. Check-in and check-out events are near-real-time.

## Service Categories

Gingr `reservation_type` maps to business categories:
- Contains "GROOM" → **grooming**
- Contains "DAYCARE", "DAY PASS", or "PLAY DATE" → **daycare**
- Everything else → **boarding**

## Cached Tables in Supabase

| Supabase Table | Source | Sync Method |
|---------------|--------|-------------|
| `reservation` | Gingr reservations | Webhook + hourly cron |
| `customer_links` | Gingr owners | Lazily populated from reservations |
| `breeds` | Gingr breeds API | One-time load |

## When to Use Gingr vs Supabase

- **For occupancy/trends** — use `forecast_historical_occupancy` (pre-aggregated daily counts by boarding/daycare/grooming). Never scan the `reservation` table for occupancy counts.
- **For individual reservations** — use the `reservation` table (e.g., finding a specific pet or owner's bookings)
- **Use Gingr API only** for real-time owner contact info not cached in Supabase
- **Never call Gingr** for bulk data — it's too slow and will timeout

## Gingr Portal Links

For reference or sharing with staff:
- Owner page: `https://pawsvip.gingrapp.com/owners/view/id/{ownerId}`
- Reservation page: `https://pawsvip.gingrapp.com/reservations/view/id/{reservationId}`
