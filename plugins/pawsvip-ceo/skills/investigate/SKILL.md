---
name: investigate
description: "Deep dive investigation on any business topic using database queries. Use when the user wants to research, analyze, or explore PawsVIP business data."
user-invocable: true
argument-hint: "[topic to investigate]"
---

# Investigate

Deep dive on: $ARGUMENTS

Use all available connectors and skills to research this topic thoroughly. Query the Supabase database, and if QuickBooks data is relevant and the QBO connector is available, query that too.

## Guidelines

1. **Start broad, then narrow** — run initial queries to understand the landscape, then drill into specifics
2. **Show your work** — include the SQL queries you ran so the CEO can verify or modify them
3. **Present data in tables** — numeric data is always clearer in table format
4. **Include temporal context** — always compare to last week, last month, or same period last year when relevant
5. **Name names** — use staff names (from pawsvip_staff), location names, pet names — not IDs
6. **End with actionable insights** — what does this data mean? What should the CEO consider doing?

## Output Format

```
## Investigation: [topic]

### Summary
[2-3 sentence executive summary of findings]

### Data
[tables, charts, key metrics]

### Queries Used
[SQL queries for transparency and reproducibility]

### Insights
[what the data means for the business]

### Recommended Actions
[concrete next steps, if any]
```

After completing the investigation, log this interaction by INSERTing into the `ceo_query_log` table with command = 'investigate'.
