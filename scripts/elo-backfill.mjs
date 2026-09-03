#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { buildHistoricalEloReport } from "../lib/elo/backfill-report.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

const printReport = (report) => {
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Processed matches: ${report.processedMatches}`);
  console.log(`Players: ${report.players}`);
  if (report.validationErrors.length) {
    console.log("Validation errors:");
    report.validationErrors.forEach((error) => console.log(`- ${error}`));
    return;
  }
  console.table(report.rows.map((row) => ({
    Member: row.name,
    Rank: row.rank,
    Level: `Level ${row.level}`,
    Matches: row.matches,
    Actual: row.actual,
    Expected: row.expected,
    Diff: row.diff,
    Pass: row.pass,
  })));
  console.log(`Acceptance: ${report.ok ? "PASS" : "FAIL"}`);
};

const report = buildHistoricalEloReport();
printReport(report);
if (!apply) process.exit(report.ok ? 0 : 1);
if (!report.ok) {
  console.error("Backfill apply stopped because dry-run acceptance did not pass.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error } = await supabase.rpc("recalculate_elo_from_matches");
if (error) {
  console.error(`Could not apply ELO backfill: ${error.message}`);
  process.exit(1);
}

console.log("Applied ELO rebuild through public.recalculate_elo_from_matches().");
