import { z } from 'zod';

export const MAX_RECORDS_PER_SIDE = 1000;
const token = z.string().min(1).max(160).refine(s => s === s.trim() && !/\p{Cc}/u.test(s), 'Use exact nonblank text without surrounding whitespace or control characters');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return s.slice(0, 4) !== '0000' && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Use a real ISO calendar date (year 0001-9999)');
export const recordSchema = z.object({
  record_id: token, entity_id: token, supplier_id: token,
  currency: z.string().regex(/^[A-Z]{3}$/),
  document_type: z.enum(['invoice', 'credit_note']), document_reference: token,
  document_date: date, outstanding_minor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict();
const records = z.array(recordSchema).max(MAX_RECORDS_PER_SIDE).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.record_id)) ctx.addIssue({ code: 'custom', path: [index, 'record_id'], message: 'record_id must be unique within this side' });
    seen.add(row.record_id);
  });
});
export const checkSchema = z.object({ as_of: date, statement_records: records, ledger_records: records, save: z.boolean().default(false) }).strict().superRefine((input, ctx) => {
  if (!input.statement_records.length && !input.ledger_records.length) ctx.addIssue({ code: 'custom', path: ['statement_records'], message: 'Supply at least one record across the two sides' });
});
export type CheckInput = z.infer<typeof checkSchema>;
export type OpenItem = z.infer<typeof recordSchema>;
export type Side = 'statement' | 'ledger';
export type GroupStatus = 'matched' | 'only_in_statement' | 'only_in_ledger' | 'discrepancy' | 'ambiguous_reference';
export type Issue = 'amount_mismatch' | 'date_mismatch';
export interface ItemKey { entity_id: string; supplier_id: string; currency: string; document_type: OpenItem['document_type']; document_reference: string }
export interface MatchGroup { group_id: string; key: ItemKey; status: GroupStatus; issues: Issue[]; statement_record_ids: string[]; ledger_record_ids: string[]; explanation: string }
export interface SupplierReport {
  schema_version: 1; status: 'discrepancies_for_review' | 'no_discrepancies_in_supplied_open_items';
  as_of: string; scope: string;
  summary: { statement_record_count: number; ledger_record_count: number; group_count: number; matched_group_count: number; review_group_count: number; only_in_statement_group_count: number; only_in_ledger_group_count: number; discrepancy_group_count: number; ambiguous_group_count: number; amount_mismatch_group_count: number; date_mismatch_group_count: number };
  statement_records: OpenItem[]; ledger_records: OpenItem[]; groups: MatchGroup[];
  policy: { matching: string; scope_fields: string[]; limitations: string[] };
}
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const itemKey = (r: OpenItem): ItemKey => ({ entity_id: r.entity_id, supplier_id: r.supplier_id, currency: r.currency, document_type: r.document_type, document_reference: r.document_reference });
const serializeKey = (r: OpenItem) => JSON.stringify([r.entity_id, r.supplier_id, r.currency, r.document_type, r.document_reference]);

/** O(N log N), one group per exact key; no pair expansion or guessed allocation. */
export function check(raw: unknown): SupplierReport {
  const input = checkSchema.parse(raw);
  const statement = input.statement_records.slice().sort((a, b) => compare(a.record_id, b.record_id));
  const ledger = input.ledger_records.slice().sort((a, b) => compare(a.record_id, b.record_id));
  const buckets = new Map<string, { key: ItemKey; statement: OpenItem[]; ledger: OpenItem[] }>();
  for (const [side, rows] of [['statement', statement], ['ledger', ledger]] as const) for (const row of rows) {
    const key = serializeKey(row), bucket = buckets.get(key) ?? { key: itemKey(row), statement: [], ledger: [] };
    bucket[side].push(row); buckets.set(key, bucket);
  }
  const groups: MatchGroup[] = [...buckets].sort(([a], [b]) => compare(a, b)).map(([, bucket], index) => {
    let status: GroupStatus; const issues: Issue[] = []; let explanation: string;
    if (bucket.statement.length > 1 || bucket.ledger.length > 1) {
      status = 'ambiguous_reference'; explanation = 'An exact scoped reference repeats on at least one side. Every source row is retained; no pairing or allocation is inferred.';
    } else if (!bucket.ledger.length) {
      status = 'only_in_statement'; explanation = 'This exact scoped reference is present only in the supplied statement. Review export scope, timing and source documents.';
    } else if (!bucket.statement.length) {
      status = 'only_in_ledger'; explanation = 'This exact scoped reference is present only in the supplied AP ledger. Review export scope, timing and source documents.';
    } else {
      const left = bucket.statement[0], right = bucket.ledger[0];
      if (left.outstanding_minor !== right.outstanding_minor) issues.push('amount_mismatch');
      if (left.document_date !== right.document_date) issues.push('date_mismatch');
      status = issues.length ? 'discrepancy' : 'matched';
      explanation = issues.length ? 'One record on each side shares the exact scoped reference; its supplied outstanding amount or document date differs. Original values remain available.' : 'One record on each side has the same exact scoped reference, outstanding minor-unit amount and document date. Agreement of supplied rows is not a balance or payment decision.';
    }
    return { group_id: `G${String(index + 1).padStart(4, '0')}`, key: bucket.key, status, issues, statement_record_ids: bucket.statement.map(r => r.record_id), ledger_record_ids: bucket.ledger.map(r => r.record_id), explanation };
  });
  const count = (status: GroupStatus) => groups.filter(g => g.status === status).length;
  const matched = count('matched');
  return {
    schema_version: 1, status: groups.length === matched ? 'no_discrepancies_in_supplied_open_items' : 'discrepancies_for_review',
    as_of: input.as_of, scope: 'Exact-key comparison of two supplied open-item lists only. No balance reconciliation, payment matching or approval, ERP access, or completeness guarantee.',
    summary: { statement_record_count: statement.length, ledger_record_count: ledger.length, group_count: groups.length, matched_group_count: matched, review_group_count: groups.length - matched, only_in_statement_group_count: count('only_in_statement'), only_in_ledger_group_count: count('only_in_ledger'), discrepancy_group_count: count('discrepancy'), ambiguous_group_count: count('ambiguous_reference'), amount_mismatch_group_count: groups.filter(g => g.issues.includes('amount_mismatch')).length, date_mismatch_group_count: groups.filter(g => g.issues.includes('date_mismatch')).length },
    statement_records: statement, ledger_records: ledger, groups,
    policy: { matching: 'Exact entity, supplier, currency, document type and document reference. No trimming, case folding, Unicode normalization, punctuation removal or leading-zero conversion.', scope_fields: ['entity_id', 'supplier_id', 'currency', 'document_type', 'document_reference'], limitations: ['The declared as_of date does not validate export freshness or completeness and does not filter records by document date.', 'Credit notes use positive absolute outstanding amounts and match only credit notes. No netting, payment allocation or opening/closing balance is calculated.', 'A repeated reference is ambiguous even if amounts could be paired. A missing item can reflect timing or export scope rather than an accounting error.', 'Agreement can occur between two incomplete or stale exports. Currency codes are syntax checked, not checked against a currency registry.', 'No PDFs, OCR, ERP connection, accounting writeback, tax interpretation, fraud verdict or permission to pay.'] },
  };
}
export function reportRecords(report: SupplierReport) {
  const groupFor = new Map<string, MatchGroup>();
  for (const group of report.groups) for (const side of ['statement', 'ledger'] as const) for (const id of group[`${side}_record_ids`]) groupFor.set(JSON.stringify([side, id]), group);
  return (['statement', 'ledger'] as const).flatMap(side => report[`${side}_records`].map(record => {
    const group = groupFor.get(JSON.stringify([side, record.record_id]))!;
    return { side, ...record, group_id: group.group_id, group_status: group.status, issues: group.issues };
  }));
}
export function exportCsv(report: SupplierReport, offset = 0, limit = 2000): string {
  const fields = ['as_of', 'side', 'record_id', 'entity_id', 'supplier_id', 'currency', 'document_type', 'document_reference', 'document_date', 'outstanding_minor', 'group_id', 'group_status', 'issues'] as const;
  const cell = (value: unknown) => {
    let text = Array.isArray(value) ? value.join(';') : value == null ? '' : String(value);
    if (/^[\s\p{Cf}]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [fields.map(cell).join(','), ...reportRecords(report).slice(offset, offset + limit).map(row => {
    const values = { as_of: report.as_of, ...row };
    return fields.map(field => cell(values[field])).join(',');
  })].join('\r\n') + '\r\n';
}
