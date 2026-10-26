import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { TEST_TMP_ROOT, removeTree } from './_tmp-scope.mjs';
export function record(record_id = 'R1', changes = {}) { return { record_id, entity_id: 'ENTITY-1', supplier_id: 'SUPPLIER-1', currency: 'USD', document_type: 'invoice', document_reference: 'INV-001', document_date: '2026-10-01', outstanding_minor: 10000, ...changes }; }
export function fixture() { return { as_of: '2026-10-26', statement_records: [record('S1'), record('S2', { document_reference: 'INV-002', outstanding_minor: 25000 }), record('S3', { document_reference: 'INV-003' })], ledger_records: [record('L1'), record('L2', { document_reference: 'INV-002', outstanding_minor: 20000, document_date: '2026-10-02' }), record('L4', { document_reference: 'INV-004' })], save: false }; }
export function temporary() { const dir = mkdtempSync(join(TEST_TMP_ROOT, 'supplier-statement-check-')); return { dir, cleanup() { removeTree(dir); assert.equal(existsSync(dir), false, 'Safe lsof-checked fixture cleanup must complete'); } }; }
