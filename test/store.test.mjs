import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check } from '../dist/core.js';
import { saveReport, listReports, getReport, deleteReport, dataDir, assertStorageBudget, MAX_STORAGE_BYTES } from '../dist/store.js';
import { fixture, temporary } from './helpers.mjs';
const use=async run=>{const temp=temporary(),prior=process.env.XDG_DATA_HOME;process.env.XDG_DATA_HOME=temp.dir;try{return await run(temp.dir);}finally{if(prior===undefined)delete process.env.XDG_DATA_HOME;else process.env.XDG_DATA_HOME=prior;temp.cleanup();}};

test('atomic saved reports obey free cap, Pro extends count and delete frees a slot',()=>use(async()=>{
  const report=check(fixture()),first=await saveReport(report,false);
  await saveReport(report,false);await saveReport(report,false);
  assert.equal(await saveReport(report,false),null);assert.equal(listReports().total,3);
  assert.equal(listReports(1,1).reports.length,1);
  assert.deepEqual(getReport(first.id).report,report);
  assert.equal(await deleteReport(first.id).then(x=>x.deleted),first.id);
  assert((await saveReport(report,false))?.id);
  assert((await saveReport(report,true))?.id);assert.equal(listReports().total,4);
  assert.equal(readdirSync(dataDir()).filter(name=>name.endsWith('.tmp')).length,0);
  assert.throws(()=>getReport('../secret'),/Invalid report id/);
}));
test('concurrent free saves cannot exceed three slots',()=>use(async()=>{
  const results=await Promise.all(Array.from({length:10},()=>saveReport(check(fixture()),false)));
  assert.equal(results.filter(Boolean).length,3);assert.equal(listReports().total,3);
}));
test('separate Node processes enforce the same three-report cap',()=>use(async base=>{
  const run=promisify(execFile),store=new URL('../dist/store.js',import.meta.url).href,core=new URL('../dist/core.js',import.meta.url).href;
  const code=`import{saveReport}from${JSON.stringify(store)};import{check}from${JSON.stringify(core)};const value=await saveReport(check(${JSON.stringify(fixture())}),false);console.log(Boolean(value));`;
  const results=await Promise.all(Array.from({length:6},()=>run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,XDG_DATA_HOME:base},timeout:15000})));
  assert.equal(results.filter(result=>result.stdout.trim()==='true').length,3);assert.equal(listReports().total,3);
}));
test('stored output is recomputed from validated inputs rather than trusted',()=>use(async()=>{
  const saved=await saveReport(check(fixture()),false),path=join(dataDir(),saved.id+'.json');
  const raw=JSON.parse(readFileSync(path,'utf8'));raw.report.groups=[];raw.report.summary.matched_group_count=9999;
  writeFileSync(path,JSON.stringify(raw));assert.equal(getReport(saved.id).report.summary.matched_group_count,1);
  raw.report.statement_records[0].outstanding_minor=-1;writeFileSync(path,JSON.stringify(raw));assert.throws(()=>getReport(saved.id));
}));
test('corrupt metadata and JSON fail closed without losing other saved reports',()=>use(async()=>{
  const saved=await saveReport(check(fixture()),false),path=join(dataDir(),saved.id+'.json'),original=readFileSync(path,'utf8');
  const raw=JSON.parse(original);raw.id='00000000-0000-4000-8000-000000000000';writeFileSync(path,JSON.stringify(raw));assert.throws(()=>getReport(saved.id),/metadata/);
  writeFileSync(path,'{not json');assert.throws(()=>getReport(saved.id));
  writeFileSync(path,original);assert.equal(listReports().total,1);
  if(process.platform!=='win32')assert.equal(lstatSync(path).mode&0o777,0o600);
}));
test('symlinked files and configured storage ancestors are rejected',()=>use(async base=>{
  const target=join(base,'outside.json');writeFileSync(target,'{}');
  const id='00000000-0000-4000-8000-000000000001';symlinkSync(target,join(dataDir(),id+'.json'));
  assert.throws(()=>getReport(id),/Invalid saved report/);await assert.rejects(()=>deleteReport(id),/Invalid saved report/);
  const nested=join(base,'nested');mkdirSync(nested);symlinkSync(nested,join(base,'linked'));
  process.env.XDG_DATA_HOME=join(base,'linked');assert.throws(()=>dataDir(),/real directory/);
}));
test('relative storage roots fail and aggregate budget has exact checked boundaries',()=>use(async()=>{
  process.env.XDG_DATA_HOME='relative-data';assert.throws(()=>dataDir(),/absolute path/);
  assert.doesNotThrow(()=>assertStorageBudget(MAX_STORAGE_BYTES-1,1));
  for(const pair of [[MAX_STORAGE_BYTES,1],[-1,1],[1,-1],[NaN,1],[Infinity,0],[1.5,1],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]])assert.throws(()=>assertStorageBudget(...pair),/storage limit/);
}));
