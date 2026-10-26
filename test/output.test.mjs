import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../dist/core.js';
import { boundedReport, resolveReport, reportPage, csvPage, fitsInline, PREVIEW_TTL_MS } from '../dist/output.js';
import { record, fixture } from './helpers.mjs';

test('all preview evidence remains available by source and group pages',()=>{
  const report=check(fixture()),out=boundedReport(report),id=out.retrieval.report_id;
  assert(id.startsWith('preview:'));assert.equal(resolveReport(id),report);
  const first=reportPage({id,section:'groups',offset:0,limit:1});assert.equal(first.rows.length,1);assert.equal(first.next_offset,1);
  assert.equal('statement_record_ids' in first.rows[0],false);
  for(const section of ['statement_records','ledger_records']){
    let offset=0,rows=[];do{const page=reportPage({id,section,offset,limit:1});rows.push(...page.rows);offset=page.next_offset;}while(offset!==null);
    assert.deepEqual(rows,report[section]);
  }
  const group=report.groups.find(x=>x.status==='discrepancy');const members=reportPage({id,section:'group_members',group_id:group.group_id,offset:0,limit:100});
  assert.deepEqual(members.rows.map(r=>r.side),['statement','ledger']);assert.equal(members.total,2);
  assert.throws(()=>reportPage({id,section:'group_members',offset:0,limit:1}),/existing group_id/);
  assert.equal(csvPage(report,id,0,2).next_offset,2);
  assert.equal(csvPage(report,id,6,2).returned,0);
});
test('third preview evicts only oldest; expiry and restart are explicit errors',()=>{
  const first=boundedReport(check(fixture())).retrieval.report_id;
  const second=boundedReport(check(fixture())).retrieval.report_id;
  const third=boundedReport(check(fixture())).retrieval.report_id;
  assert.throws(()=>resolveReport(first),/expired, was evicted/);assert(resolveReport(second));assert(resolveReport(third));
  const realNow=Date.now;try{Date.now=()=>realNow()+PREVIEW_TTL_MS+1;assert.throws(()=>resolveReport(third),/expired, was evicted/);}finally{Date.now=realNow;}
  assert.throws(()=>resolveReport('preview:00000000-0000-4000-8000-000000000001'),/another process/);
});
test('maximum long-field report is paginated and every requested source and CSV row survives',()=>{
  const list=prefix=>Array.from({length:1000},(_,i)=>record(`${prefix}${String(i).padStart(4,'0')}`,{entity_id:'e'.repeat(160),supplier_id:'s'.repeat(160),document_reference:`REF-${i}-`+'漢'.repeat(150)}));
  const report=check({as_of:'2026-10-26',statement_records:list('S'),ledger_records:list('L')});
  const out=boundedReport(report),id=out.retrieval.report_id;assert.equal(out.paginated,true);assert(fitsInline({report:out}));
  let offset=0,count=0,pages=0;
  do{const page=csvPage(report,id,offset,2000);assert(fitsInline(page));assert(page.returned>0);count+=page.returned;pages++;offset=page.next_offset;}while(offset!==null);
  assert.equal(count,2000);assert(pages>1);
  for(const section of ['statement_records','ledger_records','groups']){let offset=0,count=0;do{const page=reportPage({id,section,offset,limit:100});assert(fitsInline(page));assert(page.returned>0);count+=page.returned;offset=page.next_offset;}while(offset!==null);assert.equal(count,1000);}
  assert.equal(reportPage({id,section:'ledger_records',offset:Number.MAX_SAFE_INTEGER,limit:1}).next_offset,null);
});
