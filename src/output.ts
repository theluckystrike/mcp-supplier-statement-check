import { randomUUID } from 'node:crypto';
import { exportCsv, reportRecords, type SupplierReport } from './core.js';
import { getReport } from './store.js';

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const PREVIEW_CAP = 2;
export const INLINE_LIMIT = 512 * 1024;
const previews = new Map<string, { report: SupplierReport; expires: number }>();
export const pageSections = ['statement_records', 'ledger_records', 'groups', 'group_members'] as const;
export type PageSection = typeof pageSections[number];
function clean() { for (const [id, value] of previews) if (value.expires <= Date.now()) previews.delete(id); }
export function fitsInline(value: unknown) { const text = JSON.stringify(value); return Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text }] }), 'utf8') <= INLINE_LIMIT - 2048; }
export function resolveReport(id: string): SupplierReport {
  clean(); if (!id.startsWith('preview:')) return getReport(id).report;
  const preview = previews.get(id);
  if (!preview) throw new Error('Preview expired, was evicted, or belongs to another process. Resubmit the free check.');
  return preview.report;
}
export function boundedReport(report: SupplierReport, savedId?: string) {
  clean(); let id = savedId; let expires: number | undefined;
  if (!id) {
    id = `preview:${randomUUID()}`; expires = Date.now() + PREVIEW_TTL_MS;
    while (previews.size >= PREVIEW_CAP) previews.delete(previews.keys().next().value!);
    previews.set(id, { report, expires });
  }
  const retrieval = { report_id: id, page_tool: 'report_page', export_tool: 'report_export_csv', sections: pageSections, ...(expires === undefined ? {} : { expires_at: new Date(expires).toISOString(), preview_policy: 'Last two checks in this process for 30 minutes; resubmit after eviction, expiry or restart.' }) };
  const full = { ...report, retrieval };
  if (fitsInline({ report: full })) return full;
  return { schema_version: report.schema_version, status: report.status, as_of: report.as_of, scope: report.scope, summary: report.summary, policy: report.policy, paginated: true, retrieval };
}
/** Adapt a page to the escaped MCP envelope without dropping evidence. */
function boundedPage<T>(wanted: number, build: (count: number) => T): T {
  const full = build(wanted); if (fitsInline(full)) return full;
  let low = 0, high = wanted - 1, best: T | undefined;
  while (low <= high) {
    const count = Math.floor((low + high) / 2), candidate = build(count);
    if (fitsInline(candidate)) { if (count > 0 || wanted === 0) best = candidate; low = count + 1; }
    else high = count - 1;
  }
  if (!best) throw new Error('One evidence row exceeds the response budget. Retrieve its source record fields separately.');
  return best;
}
export function reportPage(args: { id: string; section: PageSection; offset: number; limit: number; group_id?: string }) {
  const report = resolveReport(args.id); let rows: unknown[];
  if (args.section === 'group_members') {
    const group = report.groups.find(g => g.group_id === args.group_id);
    if (!group) throw new Error('group_members requires an existing group_id.');
    rows = reportRecords(report).filter(row => row.group_id === group.group_id);
  } else if (args.section === 'groups') rows = report.groups.map(({ statement_record_ids, ledger_record_ids, ...group }) => ({ ...group, statement_member_count: statement_record_ids.length, ledger_member_count: ledger_record_ids.length }));
  else rows = report[args.section];
  const wanted = Math.min(args.limit, Math.max(0, rows.length - args.offset));
  return boundedPage(wanted, count => ({ id: args.id, section: args.section, ...(args.group_id ? { group_id: args.group_id } : {}), offset: args.offset, limit: args.limit, total: rows.length, returned: count, next_offset: args.offset + count < rows.length ? args.offset + count : null, rows: rows.slice(args.offset, args.offset + count) }));
}
export function csvPage(report: SupplierReport, id: string, offset: number, limit: number) {
  const total = report.statement_records.length + report.ledger_records.length;
  const wanted = Math.min(limit, Math.max(0, total - offset));
  return boundedPage(wanted, count => ({ id, csv: exportCsv(report, offset, count), offset, returned: count, total_rows: total, next_offset: offset + count < total ? offset + count : null }));
}
