// Independent review: relational invariants, byte-exact evidence and real processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check, reportRecords } from '../dist/core.js';
import { boundedReport, reportPage, csvPage, INLINE_LIMIT } from '../dist/output.js';
import { getReport, listReports } from '../dist/store.js';
import { record, temporary } from './helpers.mjs';

const execute = promisify(execFile);
function parseCsv(text) {
  const rows = []; let row = [], value = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quote = false;
      else value += c;
    } else if (c === '"') quote = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += c;
  }
  assert.equal(quote, false); assert.deepEqual(row, []); assert.equal(value, '');
  return rows;
}
const envelopeSize = value => Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 123, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }));

test('review: swapping supplied sides is an involution without changing disagreement evidence', () => {
  const left = [record('A', { document_reference: '__proto__' }), record('B', { document_reference: '001', outstanding_minor: 1 }), record('C', { document_reference: 'Á', document_type: 'credit_note' }), record('D', { document_reference: 'repeat' }), record('E', { document_reference: 'repeat' })];
  const right = [record('X', { document_reference: '__proto__' }), record('Y', { document_reference: '001', outstanding_minor: 2, document_date: '2024-02-29' }), record('Z', { document_reference: 'A\u0301', document_type: 'credit_note' }), record('T', { document_reference: 'repeat' })];
  const forward = check({ as_of: '2026-10-26', statement_records: left, ledger_records: right });
  const reverse = check({ as_of: '2026-10-26', statement_records: right, ledger_records: left });
  const flip = { only_in_statement: 'only_in_ledger', only_in_ledger: 'only_in_statement' };
  assert.equal(forward.status, reverse.status);
  for (let i = 0; i < forward.groups.length; i++) {
    const a = forward.groups[i], b = reverse.groups[i];
    assert.deepEqual(a.key, b.key); assert.equal(b.status, flip[a.status] || a.status);
    assert.deepEqual(a.issues, b.issues);
    assert.deepEqual(a.statement_record_ids, b.ledger_record_ids);
    assert.deepEqual(a.ledger_record_ids, b.statement_record_ids);
  }
  assert.equal(forward.summary.matched_group_count, 1);
  assert.equal(forward.summary.discrepancy_group_count, 1);
  assert.equal(forward.summary.ambiguous_group_count, 1);
});

test('review: escaped maximum evidence pages preserve every original field under actual MCP envelope budget', () => {
  const long = '"\\漢'.repeat(50);
  const make = prefix => Array.from({ length: 1000 }, (_, i) => record(prefix + String(i).padStart(4, '0'), { entity_id: long, supplier_id: 'supplier-' + long, document_reference: `REF-${i}-` + long }));
  const report = check({ as_of: '2026-10-26', statement_records: make('S'), ledger_records: make('L') });
  const presented = boundedReport(report), id = presented.retrieval.report_id;
  assert.equal(presented.paginated, true); assert(envelopeSize({ report: presented, saved: false }) < INLINE_LIMIT);
  for (const section of ['statement_records', 'ledger_records']) {
    const restored = []; let offset = 0;
    do {
      const page = reportPage({ id, section, offset, limit: 100 });
      assert(envelopeSize(page) < INLINE_LIMIT); assert(page.returned > 0);
      restored.push(...page.rows); offset = page.next_offset;
    } while (offset !== null);
    assert.deepEqual(restored, report[section]);
  }
  const exported = []; let offset = 0;
  do {
    const page = csvPage(report, id, offset, 2000);
    assert(envelopeSize(page) < INLINE_LIMIT); assert(page.returned > 0);
    const [headers, ...rows] = parseCsv(page.csv);
    exported.push(...rows.map(values => Object.fromEntries(headers.map((field, i) => [field, values[i]]))));
    offset = page.next_offset;
  } while (offset !== null);
  const originals = reportRecords(report);
  assert.equal(exported.length, originals.length);
  for (let i = 0; i < originals.length; i++) for (const field of ['side', 'record_id', 'entity_id', 'supplier_id', 'document_reference', 'outstanding_minor', 'group_id', 'group_status']) assert.equal(exported[i][field], String(originals[i][field]), `${i}:${field}`);
});

test('review: a 2000-member ambiguous group has complete free member evidence without guessed pairing', () => {
  const make = prefix => Array.from({ length: 1000 }, (_, i) => record(prefix + String(i).padStart(4, '0')));
  const report = check({ as_of: '2026-10-26', statement_records: make('S'), ledger_records: make('L') });
  const id = boundedReport(report).retrieval.report_id;
  const groups = reportPage({ id, section: 'groups', offset: 0, limit: 100 });
  assert.equal(groups.rows[0].status, 'ambiguous_reference');
  assert.equal(groups.rows[0].statement_member_count, 1000); assert.equal(groups.rows[0].ledger_member_count, 1000);
  const restored = []; let offset = 0;
  do {
    const page = reportPage({ id, section: 'group_members', group_id: report.groups[0].group_id, offset, limit: 100 });
    assert(envelopeSize(page) < INLINE_LIMIT); assert(page.returned > 0);
    restored.push(...page.rows); offset = page.next_offset;
  } while (offset !== null);
  assert.deepEqual(restored, reportRecords(report));
  assert.equal(new Set(restored.map(r => JSON.stringify([r.side, r.record_id]))).size, 2000);
});

test('review: two independent OS processes share the three-report free cap and leave valid atomic files', { timeout: 30000 }, async () => {
  const temp = temporary(), previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = temp.dir;
  try {
    const core = new URL('../dist/core.js', import.meta.url).href, store = new URL('../dist/store.js', import.meta.url).href;
    const payload = { as_of: '2026-10-26', statement_records: [record('S')], ledger_records: [record('L')] };
    const code = `import {check} from ${JSON.stringify(core)};import {saveReport} from ${JSON.stringify(store)};const r=check(JSON.parse(process.argv[1]));const results=[];for(let i=0;i<3;i++){const saved=await saveReport(r,false);results.push(saved?.id||null);}console.log(JSON.stringify(results));`;
    const results = await Promise.all([0, 1].map(() => execute(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(payload)], { env: { ...process.env, XDG_DATA_HOME: temp.dir }, timeout: 20000, maxBuffer: 1024 * 1024 })));
    const ids = results.flatMap(r => JSON.parse(r.stdout)).filter(Boolean);
    assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3); assert.equal(listReports().total, 3);
    for (const id of ids) assert.deepEqual(getReport(id).report.statement_records, payload.statement_records);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = previous;
    temp.cleanup();
  }
});
