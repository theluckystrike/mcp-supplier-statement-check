#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLicenseGate } from '@theluckystrike/mcp-license';
import { checkSchema, check } from './core.js';
import { saveReport, listReports, getReport, deleteReport } from './store.js';
import { boundedReport, reportPage, pageSections, resolveReport, csvPage } from './output.js';
import { VERSION } from './version.js';

const server = new McpServer({ name: 'supplier-statement-check', version: VERSION });
const gate = createLicenseGate({ product: 'supplier-statement-check' });
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const error = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true as const });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const id = z.string().regex(new RegExp(`^${uuid}$`));
const anyId = z.string().regex(new RegExp(`^(?:preview:)?${uuid}$`));
const offset = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0);

server.registerTool('supplier_statement_check', { title: 'Compare supplier statement and AP open items', description: 'Compare two supplied open-item lists of up to 1000 records each by exact entity, supplier, currency, document type and reference. Flag missing-side items, amount/date discrepancies and ambiguous repeated references. All evidence is free; no balance or payment approval.', inputSchema: checkSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async args => {
  try {
    const report = check(args);
    if (!args.save) return json({ report: boundedReport(report), saved: false });
    try {
      const saved = await saveReport(report, gate.isPro());
      return saved ? json({ report: boundedReport(report, saved.id), saved: true, id: saved.id, created_at: saved.created_at }) : json({ report: boundedReport(report), saved: false, save_error: 'free_saved_report_cap', upgrade: gate.upgradeText('More than 3 saved reports', 'supplier_statement_check'), payment: gate.payment('free_tier_cap', 'More than 3 saved reports', 'supplier_statement_check') });
    } catch (e) { return json({ report: boundedReport(report), saved: false, save_error: e instanceof Error ? e.message : String(e) }); }
  } catch (e) { return error(e); }
});
server.registerTool('report_list', { title: 'List saved open-item checks', description: 'List saved report ids, timestamps and review-group counts. Free on both tiers; up to 100 reports per page.', inputSchema: z.object({ offset, limit: z.number().int().min(1).max(100).default(20) }).strict(), annotations: readOnly }, async ({ offset, limit }) => { try { return json(listReports(offset, limit)); } catch (e) { return error(e); } });
server.registerTool('report_get', { title: 'Read a saved open-item check', description: 'Read a saved comparison with complete source evidence. Large reports return free paging instructions.', inputSchema: z.object({ id }).strict(), annotations: readOnly }, async ({ id }) => { try { const saved = getReport(id); return json({ ...saved, report: boundedReport(saved.report, id) }); } catch (e) { return error(e); } });
server.registerTool('report_page', { title: 'Read complete open-item evidence pages', description: 'Read free pages of either source list, group summaries or one group’s source members. Unsaved previews last 30 minutes for the last two checks in this process.', inputSchema: z.object({ id: anyId, section: z.enum(pageSections), offset, limit: z.number().int().min(1).max(100).default(100), group_id: z.string().regex(/^G\d{4}$/).optional() }).strict(), annotations: readOnly }, async args => { try { return json(reportPage(args)); } catch (e) { return error(e); } });
server.registerTool('report_delete', { title: 'Delete one saved open-item check', description: 'Delete one local comparison report and free a saved-report slot. Does not alter accounting records.', inputSchema: z.object({ id }).strict(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async ({ id }) => { try { return json(await deleteReport(id)); } catch (e) { return error(e); } });
server.registerTool('report_export_csv', { title: 'Export complete open-item evidence as CSV', description: 'Export free CSV pages from a saved report or unsaved preview. One row per supplied source item, with side, group and issues. Formula-like cells are escaped; no amount-loss or balance total is calculated.', inputSchema: z.object({ id: anyId, offset, limit: z.number().int().min(1).max(2000).default(2000) }).strict(), annotations: readOnly }, async ({ id, offset, limit }) => { try { return json(csvPage(resolveReport(id), id, offset, limit)); } catch (e) { return error(e); } });
gate.registerTools(server);
server.connect(new StdioServerTransport()).catch(e => { process.stderr.write(`supplier-statement-check: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
