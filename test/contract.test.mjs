import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('published supplier descriptors agree on the version, local transport and canonical paid scope', () => {
  const pkg = json('package.json');
  assert.equal(pkg.name, '@theluckystrike/mcp-supplier-statement-check');
  assert.equal(pkg.bin['mcp-supplier-statement-check'], 'dist/index.js');
  for (const name of ['server.json', 'server.mcpb.json', 'server.vendor-statement.json']) {
    const manifest = json(name);
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.remotes, undefined, 'Do not advertise a nonexistent hosted endpoint');
    assert.ok(manifest.description.length <= 100);
    const archive = manifest.packages.find(p => p.registryType === 'mcpb');
    assert.equal(archive.version, pkg.version);
    assert.equal(archive.transport.type, 'stdio');
    assert.equal(archive.identifier, `https://github.com/theluckystrike/mcp-servers/releases/download/v${pkg.version}/supplier-statement-check.mcpb`);
  }
  assert.notEqual(json('server.vendor-statement.json').name, json('server.json').name);
});

test('supplier installation documentation presents a useful free task and accurate limitations', () => {
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const install = readFileSync(new URL('llms-install.md', root), 'utf8');
  for (const text of [readme, install]) {
    assert.match(text, /compare-supplier-statement-ap-open-items-in-claude#supplier-demo/);
    assert.match(text, /outstanding|open.item/i);
    assert.match(text, /saved.report/i);
    assert.match(text, /Built by (?:\[theluckystrike\]\(https:\/\/github\.com\/theluckystrike\)|theluckystrike\b)/);
    assert.doesNotMatch(text, /command["']?\s*:\s*["']npx/);
  }
  assert.match(readme, /credit_note/);
  assert.match(readme, /as_of/);
});
