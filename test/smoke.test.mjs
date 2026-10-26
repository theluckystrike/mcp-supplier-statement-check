// Mirror note: tests that need a signed Pro key are skipped here. The signing key
// lives only in the monorepo (keys/license-private.pem); run them there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { fixture, record, temporary } from './helpers.mjs';
async function useClient(key,run,env={}){const temp=temporary();const client=new Client({name:'supplier-statement-check-test',version:'1.0.0'});const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/index.js',import.meta.url))],env:{...process.env,XDG_DATA_HOME:temp.dir,XDG_CONFIG_HOME:temp.dir,MCP_LICENSE_KEY:key,...env},stderr:'pipe'});try{await client.connect(transport);const call=async(name,args={})=>{const value=await client.callTool({name,arguments:args});assert.equal(value.isError,undefined,value.content?.[0]?.text);return JSON.parse(value.content[0].text);};return await run(client,call);}finally{await client.close();temp.cleanup();}}

test('actual stdio initialization, discovery, diagnosis, paging, save cap and CSV',{timeout:45000},()=>useClient('',async(client,call)=>{
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['supplier_statement_check','report_list','report_get','report_page','report_delete','report_export_csv','license_status','license_activate'].sort());
  assert.equal((await call('license_status')).tier,'free');
  for(const args of [{...fixture(),extra:1},{...fixture(),statement_records:[record('R',{extra:1})]},{...fixture(),statement_records:[],ledger_records:[]},{...fixture(),statement_records:[record('R',{outstanding_minor:0})]}])assert.equal((await client.callTool({name:'supplier_statement_check',arguments:args})).isError,true);
  const preview=await call('supplier_statement_check',fixture());assert.equal(preview.saved,false);assert.equal(preview.report.summary.review_group_count,3);
  assert.equal((await call('report_export_csv',{id:preview.report.retrieval.report_id})).total_rows,6);
  const first=await call('supplier_statement_check',{...fixture(),save:true});assert.equal(first.saved,true);assert.equal((await call('report_get',{id:first.id})).report.summary.review_group_count,3);
  assert.equal((await call('report_page',{id:first.id,section:'groups',limit:1})).next_offset,1);
  await call('supplier_statement_check',{...fixture(),save:true});await call('supplier_statement_check',{...fixture(),save:true});
  const capped=await call('supplier_statement_check',{...fixture(),save:true});assert.equal(capped.saved,false);assert.equal(capped.save_error,'free_saved_report_cap');assert.equal(capped.report.summary.review_group_count,3);assert.match(capped.upgrade,/\/buy\/supplier-statement-check/);
  assert.equal((await call('report_export_csv',{id:capped.report.retrieval.report_id})).total_rows,6);
  assert.equal((await call('report_list')).total,3);await call('report_delete',{id:first.id});assert.equal((await call('supplier_statement_check',{...fixture(),save:true})).saved,true);
  assert.equal((await client.callTool({name:'report_get',arguments:{id:'../secret'}})).isError,true);
}));
test.skip('actual signed single and bundle keys lift only the saved-report count',{timeout:45000,skip:!existsSync(new URL('../../../keys/license-private.pem',import.meta.url))},async()=>{
  for(const product of ['supplier-statement-check','*']){
    const key=execFileSync(process.execPath,[fileURLToPath(new URL('../../../scripts/sign-license.mjs',import.meta.url)),product],{encoding:'utf8'}).trim();
    await useClient(key,async(client,call)=>{assert.equal((await call('license_status')).tier,'pro');for(let i=0;i<4;i++)assert.equal((await call('supplier_statement_check',{...fixture(),save:true})).saved,true);assert.equal((await call('report_list')).total,4);assert.equal((await call('supplier_statement_check',fixture())).report.summary.review_group_count,3);assert.equal((await client.callTool({name:'supplier_statement_check',arguments:{...fixture(),statement_records:[record('R',{outstanding_minor:-1})]}})).isError,true);});
  }
});
test('actual stdio preserves full free diagnostics when saving fails',{timeout:45000},()=>useClient('',async(client,call)=>{
  const result=await call('supplier_statement_check',{...fixture(),save:true});
  assert.equal(result.saved,false);assert.match(result.save_error,/absolute path/);
  assert.equal(result.report.summary.review_group_count,3);
  assert.equal((await call('report_export_csv',{id:result.report.retrieval.report_id})).total_rows,6);
},{XDG_DATA_HOME:'relative-data'}));
