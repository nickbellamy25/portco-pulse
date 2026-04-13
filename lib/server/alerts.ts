// Alert evaluation migrated to RAG-based system in lib/server/analytics.ts
// Old evaluateAlerts() removed — it used absolute threshold rules (alerts table).
// Active alert system now uses % variance from plan via getLatestSubmissionRagCount().
