import test from 'node:test';
import assert from 'node:assert/strict';
import { check, checkSchema, exportCsv, reportRecords } from '../dist/core.js';
import { record, fixture } from './helpers.mjs';

test('worked comparison retains both mismatch reasons and each source row once', () => {
  const report = check(fixture());
  assert.equal(report.status, 'discrepancies_for_review');
  assert.deepEqual(report.summary, { statement_record_count: 3, ledger_record_count: 3, group_count: 4, matched_group_count: 1, review_group_count: 3, only_in_statement_group_count: 1, only_in_ledger_group_count: 1, discrepancy_group_count: 1, ambiguous_group_count: 0, amount_mismatch_group_count: 1, date_mismatch_group_count: 1 });
  assert.deepEqual(report.groups.find(g => g.status === 'discrepancy').issues, ['amount_mismatch', 'date_mismatch']);
  assert.deepEqual(reportRecords(report).map(r => [r.side, r.record_id]), [['statement','S1'],['statement','S2'],['statement','S3'],['ledger','L1'],['ledger','L2'],['ledger','L4']]);
  assert.equal(reportRecords(report).length, 6);
  assert.equal(JSON.stringify(fixture()).includes('group_id'), false);
});
test('one-to-one exact agreement reports only agreement in supplied open items', () => {
  const report = check({ as_of: '2026-10-26', statement_records: [record()], ledger_records: [record()] });
  assert.equal(report.status, 'no_discrepancies_in_supplied_open_items');
  assert.equal(report.groups[0].status, 'matched');
  assert.match(report.scope, /No balance reconciliation/);
});
test('empty side remains meaningful; two empty lists are rejected', () => {
  for (const side of ['statement_records', 'ledger_records']) {
    const report = check({ as_of: '2026-10-26', statement_records: [], ledger_records: [], [side]: [record()] });
    assert.equal(report.groups[0].status, side === 'statement_records' ? 'only_in_statement' : 'only_in_ledger');
  }
  assert.throws(() => check({ as_of: '2026-10-26', statement_records: [], ledger_records: [] }));
});
test('exact entity, supplier, currency and invoice/credit keys never cross-match', () => {
  for (const change of [{ entity_id:'OTHER' }, { supplier_id:'OTHER' }, { currency:'EUR' }, { document_type:'credit_note' }]) {
    const report = check({ as_of:'2026-10-26', statement_records:[record('S')], ledger_records:[record('L',change)] });
    assert.equal(report.summary.matched_group_count, 0);
    assert.equal(report.summary.only_in_statement_group_count, 1);
    assert.equal(report.summary.only_in_ledger_group_count, 1);
  }
});
test('leading zeros, case, punctuation and Unicode references remain exact', () => {
  for (const [left,right] of [['001','1'],['INV-a','INV-A'],['INV-01','INV01'],['A\u0301','Á'],['Ａ','A'],['INV/1','INV.1']]) {
    const report = check({ as_of:'2026-10-26', statement_records:[record('S',{document_reference:left})], ledger_records:[record('L',{document_reference:right})] });
    assert.equal(report.groups.length, 2);
    assert.equal(report.summary.matched_group_count, 0);
    assert.equal(report.statement_records[0].document_reference,left);
  }
});
test('repeated references are ambiguous before amount/date matching or side absence', () => {
  for (const ledger of [[record('L1')], [], [record('L1'),record('L2')]]) {
    const report=check({as_of:'2026-10-26',statement_records:[record('S1'),record('S2',{outstanding_minor:10001})],ledger_records:ledger});
    assert.equal(report.groups.length,1);assert.equal(report.groups[0].status,'ambiguous_reference');
    assert.equal(report.summary.matched_group_count,0);
    assert.deepEqual(report.groups[0].statement_record_ids,['S1','S2']);
    assert.equal(reportRecords(report).length,2+ledger.length);
  }
});
test('shuffled sides preserve byte-identical deterministic evidence', () => {
  const input=fixture();const shuffled={...input,statement_records:[...input.statement_records].reverse(),ledger_records:[...input.ledger_records].reverse()};
  assert.deepEqual(check(input),check(shuffled));
});
test('independent brute-force oracle verifies 80 seeded inputs and full source coverage', () => {
  let seed=9;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const key=row=>JSON.stringify([row.entity_id,row.supplier_id,row.currency,row.document_type,row.document_reference]);
  for(let round=0;round<80;round++){
    const make=prefix=>Array.from({length:1+random()%24},(_,i)=>record(`${prefix}${i}`,{entity_id:`E${random()%3}`,supplier_id:`V${random()%3}`,currency:random()%2?'USD':'EUR',document_type:random()%2?'invoice':'credit_note',document_reference:`I${random()%7}`,outstanding_minor:1+random()%7,document_date:`2026-10-${String(1+random()%3).padStart(2,'0')}`}));
    const left=make('S'),right=make('L'),report=check({as_of:'2026-10-26',statement_records:left,ledger_records:right});
    const allKeys=[...new Set([...left,...right].map(key))].sort();
    assert.equal(report.groups.length,allKeys.length);
    for(const group of report.groups){
      const wanted=JSON.stringify([group.key.entity_id,group.key.supplier_id,group.key.currency,group.key.document_type,group.key.document_reference]);
      const l=left.filter(row=>key(row)===wanted),r=right.filter(row=>key(row)===wanted);
      const expected=l.length>1||r.length>1?'ambiguous_reference':!l.length?'only_in_ledger':!r.length?'only_in_statement':l[0].outstanding_minor!==r[0].outstanding_minor||l[0].document_date!==r[0].document_date?'discrepancy':'matched';
      assert.equal(group.status,expected);
      assert.deepEqual(group.statement_record_ids,[...l].map(x=>x.record_id).sort());
      assert.deepEqual(group.ledger_record_ids,[...r].map(x=>x.record_id).sort());
    }
    assert.deepEqual(reportRecords(report).map(x=>`${x.side}:${x.record_id}`).sort(),[...left.map(x=>`statement:${x.record_id}`),...right.map(x=>`ledger:${x.record_id}`)].sort());
  }
});
test('input shape is strict, IDs side-local and references untrimmed', () => {
  for(const input of [{...fixture(),extra:1},{...fixture(),statement_records:[record('S',{extra:1})]},{...fixture(),statement_records:[record('S'),record('S')]},{...fixture(),save:'false'}]) assert.throws(()=>check(input));
  for(const value of ['', ' INV', 'INV ', 'INV\n1', 'INV\u00851']) assert.throws(()=>check({...fixture(),statement_records:[record('S',{document_reference:value})]}));
  assert.equal(check({...fixture(),statement_records:[record('S')],ledger_records:[record('S')]}).summary.matched_group_count,1);
});
test('real dates, bounded lists and positive safe integer minor amounts are enforced', () => {
  for(const value of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'100']) assert.throws(()=>check({...fixture(),statement_records:[record('S',{outstanding_minor:value})]}));
  for(const value of ['2026-02-29','1900-02-29','0000-01-01','2026-13-01','2026-10-1','2026-10-01T00:00:00Z']) assert.throws(()=>check({...fixture(),statement_records:[record('S',{document_date:value})]}));
  for(const value of ['0001-01-01','0099-12-31','2000-02-29','2024-02-29','9999-12-31']) assert.equal(check({...fixture(),statement_records:[record('S',{document_date:value,outstanding_minor:Number.MAX_SAFE_INTEGER})]}).statement_records[0].document_date,value);
  assert.throws(()=>check({...fixture(),as_of:'2026-02-29'}));
  assert.throws(()=>check({...fixture(),statement_records:Array.from({length:1001},(_,i)=>record(`S${i}`))}));
  assert.equal(checkSchema.parse({...fixture(),save:undefined}).save,false);
});
test('declared as_of never silently filters future-dated source rows',()=>{
  const report=check({as_of:'2026-01-01',statement_records:[record()],ledger_records:[record()]});
  assert.equal(report.summary.statement_record_count,1);assert.match(report.policy.limitations[0],/does not filter/);
});
test('CSV escapes formulas, invisible prefixes, commas and quotes while JSON preserves originals',()=>{
  for(const reference of ['=1+1','+SUM(1,2)','-1+2','@SUM(A1)','\u200b=1+1','ref,"quoted"']){
    const report=check({as_of:'2026-10-26',statement_records:[record('S',{document_reference:reference})],ledger_records:[]});
    const csv=exportCsv(report);assert(csv.endsWith('\r\n'));assert.equal(csv.split('\r\n').length,3);
    const expected=reference.startsWith('ref')?'"ref,""quoted"""':`"'${reference.replace(/"/g,'""')}"`;
    assert(csv.includes(expected));assert.equal(report.statement_records[0].document_reference,reference);
  }
});
test('maximum permitted input remains linear with 2000 source memberships',()=>{
  const list=prefix=>Array.from({length:1000},(_,i)=>record(`${prefix}${i}`));
  const report=check({as_of:'2026-10-26',statement_records:list('S'),ledger_records:list('L')});
  assert.equal(report.groups.length,1);assert.equal(report.groups[0].status,'ambiguous_reference');
  assert.equal(reportRecords(report).length,2000);
});
