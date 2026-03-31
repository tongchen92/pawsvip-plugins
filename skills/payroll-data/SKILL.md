---
name: payroll-data
description: Pull payroll data for a pay period — grooming tips by individual groomer plus location totals from Gingr, and credit card tips from Clover. Use this skill whenever asking about tips, groomer pay, payroll, tip totals, who earned what, or any two-week pay period breakdown.
user-invocable: true
---

# PawsVIP Payroll Data

You are pulling payroll tip data for PawsVIP. Use Supabase project ID `jkwizuoumbsoznlnsykw`. Execute SQL immediately — no discovery calls.

## Step 1 — Ask for the pay period start date

Ask the user: **"What is the start date of the pay period? (Must be a Monday, format: YYYY-MM-DD)"**

Validate:
- Must be a valid date in YYYY-MM-DD format
- Must be a Monday — if not, say "That date is a [weekday], not a Monday. Please provide a Monday."

The pay period end date = start date + 13 days (2 full weeks: Mon through Sun).

Example: start = 2026-03-16 → end = 2026-03-29

## Step 2 — Fetch Grooming Tips by Groomer

Grooming tips come from `gingr_transactions.tip_amount`. To attribute them to the right groomer, join to the `reservation` table via `transaction_pos_transaction_id`.

Two things to handle correctly:
- **Same groomer, multiple pets in one transaction**: deduplicate so the tip is only counted once
- **Multiple groomers sharing one transaction tip**: split the tip equally among them

```sql
WITH groomer_per_tx AS (
  -- One row per (transaction, groomer) — collapses same-groomer multi-pet bookings
  SELECT DISTINCT
    gt.pos_transaction_id,
    gt.tip_amount,
    gt.location_id,
    r.services_assigned_to AS groomer
  FROM gingr_transactions gt
  JOIN reservation r ON r.transaction_pos_transaction_id = gt.pos_transaction_id
  WHERE gt.sale_date BETWEEN '<START_DATE>' AND '<END_DATE>'
    AND gt.is_voided = false
    AND gt.tip_amount > 0
    AND r.services_assigned_to IS NOT NULL
),
tip_shares AS (
  -- Split tip equally among distinct groomers per transaction
  SELECT
    groomer,
    pos_transaction_id,
    location_id,
    tip_amount / COUNT(*) OVER (PARTITION BY pos_transaction_id) AS tip_share
  FROM groomer_per_tx
)
SELECT
  groomer,
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  COUNT(DISTINCT pos_transaction_id) AS tipped_transactions,
  ROUND(SUM(tip_share)::numeric, 2) AS total_tips
FROM tip_shares
GROUP BY groomer, location_id
ORDER BY total_tips DESC;
```

## Step 3 — Fetch Grooming Tips by Location (summary check)

```sql
SELECT
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  COUNT(*) FILTER (WHERE tip_amount > 0) AS tipped_transactions,
  COALESCE(SUM(tip_amount) FILTER (WHERE tip_amount > 0), 0) AS total_tips
FROM gingr_transactions
WHERE sale_date BETWEEN '<START_DATE>' AND '<END_DATE>'
  AND is_voided = false
  AND tip_amount IS NOT NULL
GROUP BY location_id
ORDER BY location_id;
```

## Step 4 — Fetch Clover Tips (All Locations)

Clover tip amounts are in cents (`tip_amount_cents`). Covers all service types (boarding, daycare, grooming).

```sql
SELECT
  CASE location_id WHEN 1 THEN 'Tukwila' WHEN 2 THEN 'Ballard' WHEN 3 THEN 'West Seattle' END AS location,
  COUNT(*) FILTER (WHERE tip_amount_cents > 0) AS tipped_transactions,
  COALESCE(SUM(tip_amount_cents) FILTER (WHERE tip_amount_cents > 0), 0) / 100.0 AS total_tips
FROM clover_transactions
WHERE created_date BETWEEN '<START_DATE>' AND '<END_DATE>'
  AND result = 'SUCCESS'
GROUP BY location_id
ORDER BY location_id;
```

## Step 5 — Present Results

```
Pay Period: <START_DATE> – <END_DATE> (2 weeks)

GROOMING TIPS BY GROOMER (Gingr)
| Groomer              | Location     | Transactions | Tips     |
|----------------------|--------------|--------------|----------|
| Sky Lake             | Tukwila      | X            | $X.XX    |
| Aliona Jessup        | Tukwila      | X            | $X.XX    |
| ...                  | ...          | ...          | ...      |
| **Total**            |              | **X**        | **$X.XX**|

GROOMING TIPS BY LOCATION (Gingr)
| Location     | Transactions | Total Tips |
|--------------|--------------|------------|
| Tukwila      | X            | $X.XX      |
| Ballard      | X            | $X.XX      |
| West Seattle | X            | $X.XX      |
| **Total**    | **X**        | **$X.XX**  |

CREDIT CARD TIPS (Clover — All Locations)
| Location     | Transactions | Total Tips |
|--------------|--------------|------------|
| Tukwila      | X            | $X.XX      |
| Ballard      | X            | $X.XX      |
| West Seattle | X            | $X.XX      |
| **Total**    | **X**        | **$X.XX**  |
```

Note: The groomer total and location total should match. If they differ slightly, it's because a small number of transactions may not have a matching reservation record (package purchases, standalone invoices).
