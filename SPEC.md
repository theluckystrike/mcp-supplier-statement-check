# Supplier statement open-item check, v0.25.0

Compare two supplied open-item lists for a declared common `as_of` date. Each list
has 0–1000 records; at least one side must be nonempty. The caller supplies exact
entity, supplier, currency, invoice/credit-note type, reference, document date and
positive safe-integer outstanding minor units. Record IDs are unique within each
side; matching record IDs across sides are allowed. Unknown fields, surrounding
whitespace, controls, invalid calendar dates and unsafe money are rejected.

The only join key is exact entity + supplier + currency + document type + reference.
Every key produces one deterministic group. A repeated key on either side is
ambiguous even if individual amounts appear to match. One-to-one keys report both
amount and date differences without guessing allocations. Every original record
is retained, appears in exactly one group, and is available in free pages and CSV.
No case folding, punctuation removal, Unicode normalization or leading-zero loss.

The declared snapshot date is a label, not evidence of export freshness. Dates do
not filter records. No opening/closing balance, payments, OCR, ERP integration,
currency conversion, data completeness or payment approval is claimed.

Free: all diagnostics, two in-process previews lasting 30 minutes, complete pages,
CSV export, three saved reports. Pro: remove only the saved-report count cap. Both
tiers retain input bounds, response limits and 64 MiB aggregate storage limit.
Candidate demand and the saved-history upgrade remain unvalidated hypotheses.

Publication gates: independent exact-key oracle; shuffled-input determinism;
every-row coverage; key, invoice/credit, Unicode and leading-zero isolation;
ambiguity; strict dates/money/fields; CSV formulas; bounded paging/expiry; storage
corruption/path guards/concurrency; real stdio/free cap; signed single/bundle Pro.
The orchestrator separately owns clean-clone, exact archive, storefront and registry
publication verification. This source package does not claim hosted availability.
