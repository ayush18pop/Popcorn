// formatReport(): the CLI text. toJSON(): the machine-readable form.

import type { Report, Verdict } from "./types.ts";

const status = (v: Verdict) => (v.ok === true ? "YES" : v.ok === false ? "NO " : "?  ");

/**
 * Plain text, one line per verdict, then one `fix` line per distinct fix of a blocking finding (alt first), then
 * `note` lines for warnings:
 *
 *   public mempool  NO   reads another contract's storage
 *   alt mempool     NO   that read needs a stake; this rule contract has none
 *   fix  Stake the rule contract: deployRule({ stake: true }) or stakeRule(address), then simulate again.
 */
export function formatReport(report: Report): string {
  const lines = [
    `public mempool  ${status(report.publicMempool)}  ${report.publicMempool.headline}`,
    `alt mempool     ${status(report.altMempool)}  ${report.altMempool.headline}`,
  ];
  const seen = new Set<string>();
  for (const f of report.findings) {
    if (seen.has(f.fix)) continue;
    seen.add(f.fix);
    lines.push(`fix  ${f.fix}`);
  }
  for (const w of report.warnings) lines.push(`note  ${w.sentence} ${w.fix}`);
  return lines.join("\n");
}

/** Stable, pretty-printed JSON of the report (it has no bigint, so it is JSON-safe as is). */
export const toJSON = (report: Report): string => JSON.stringify(report, null, 2);
