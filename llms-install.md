# Supplier statement open-item comparison MCP

Use this local stdio server when the user supplies a supplier statement's open invoices/credit notes and an AP ledger open-item export for comparison. Match exact entity, supplier, currency, document type and reference. Preserve every source row for missing items, amount/date differences and repeated-reference ambiguity. No balance reconciliation, payment allocation, PDF/OCR, ERP access or approval to pay.

Try the same engine without installation: https://mcp.zovo.one/guides/compare-supplier-statement-ap-open-items-in-claude#supplier-demo

Install the `supplier-statement-check.mcpb` from https://mcp.zovo.one/downloads#supplier-statement-check in Claude Desktop. For another local client, clone the monorepo and build:

```sh
git clone https://github.com/theluckystrike/mcp-servers.git
cd mcp-servers
npm install
node scripts/bootstrap-timezone.mjs
npm run build -w packages/mcp-license -w servers/supplier-statement-check
claude mcp add --scope user supplier-statement-check -- node /absolute/path/to/mcp-servers/servers/supplier-statement-check/dist/index.js
```

Use the user's real absolute path. No hosted endpoint or published npm package is provided. Complete diagnostics for up to 1,000 records per side, evidence pages and CSV are free. Three simultaneous saved reports are free; $19 one-time Pro removes only the saved-report-count cap. The $39 bundle includes it. Input, response and storage safety bounds remain. `license_status` reports the current tier; `license_activate` verifies a purchased key offline.

Built by theluckystrike: https://github.com/theluckystrike
