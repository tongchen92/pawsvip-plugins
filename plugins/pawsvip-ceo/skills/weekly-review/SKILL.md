---
name: weekly-review
description: "Week-over-week performance analysis across all locations. Use for weekly reviews, performance comparisons, or trend analysis."
user-invocable: true
---

# Weekly Review

Analyze this week's performance across all 3 PawsVIP locations compared to last week. Use the Supabase connector to run SQL queries.

## What to include

### 1. Occupancy Trends
Query `forecast_historical_occupancy` for the past 14 days (this week + last week). Show daily boarding, daycare, and total_occupancy per location. Present as a comparison table showing this week vs last week, day by day.

### 2. New Customers
Query `customer_links` for records created this week vs last week. Show the count and growth rate.

### 3. Gallery Engagement
- Photos shared (pet_gallery where email_notification_status = 'sent') this week vs last week
- Customer reactions (gallery_reactions) received this week vs last week
- Top uploaders by reaction count

### 4. Shift Task Completion
Query shift_task_templates and shift_task_completions for the past 14 days. Show average completion rate per location for this week vs last week.

### 5. Staffing
Query schedule_shifts for this week:
- Total shifts scheduled per location
- Unfilled shifts (staff_id IS NULL) count
- Compare to last week's staffing levels

### 6. Leads
Query leads table for new leads this week vs last week. Break down by source and status.

### 7. Revenue
If the QBO connector is available, query QuickBooks for revenue by location this week vs last week. If QBO is not connected, note: "Revenue data requires QuickBooks — check QBO directly."

## Output Format

Present all data with **vs last week** comparisons. Use tables for numeric data. End with:

```
### Key Takeaways
- [2-3 most important observations]

### Actions Needed
- [anything requiring CEO attention]

### Trends to Watch
- [emerging patterns, positive or concerning]
```

After completing the review, log this interaction by INSERTing into the `ceo_query_log` table with command = 'weekly-review'.
