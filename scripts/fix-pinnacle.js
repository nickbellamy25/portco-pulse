const Database = require("better-sqlite3");
const db = new Database("portco-pulse.db");

// Check column names
const cols = db.prepare("PRAGMA table_info(companies)").all();
console.log("Columns:", cols.map(c => c.name).join(", "));

// Find Pinnacle
const rows = db.prepare("SELECT id, name, onboarding_status, investment_date, created_at FROM companies WHERE name LIKE '%Pinnacle%'").all();
console.log("Pinnacle rows:", rows);

if (rows.length > 0) {
  for (const row of rows) {
    if (!row.onboarding_status) {
      db.prepare("UPDATE companies SET onboarding_status = 'pending' WHERE id = ?").run(row.id);
      console.log("Set onboarding_status to pending for:", row.name);
    } else {
      console.log("Already has onboarding_status:", row.onboarding_status);
    }
  }
} else {
  console.log("No Pinnacle company found in DB");
}

db.close();
