# Native tool output v1

All eight tools declare package-owned closed schemas (`src/contracts/v1/tool-output.ts`, exported with the numeric ceilings from the `/pi` subpath). Native output is independent of ordinary content and renderer details. Canonical producers execute once; no text parsing, readback, recovery replay or post-hook enforcement.

## Bounds decision (before adapter wiring)

| Family | Admitted facts | Numeric delivery ceilings |
| --- | --- | --- |
| Search | scoped exact paths (including related rows), titles/snippets, scores, safe metadata facets, raw/profile confidence, bounded provenance, cache/freshness and preview coverage | 100 rows; 20 related per row; 8 facets/confidence/profile evidence; 120-character facet values (4 tag values, 3 other values); 1,000-character snippets; 240-character descriptions; 256-character field/provider names; 4,096-character exact paths; compact DTO 65,536 UTF-8 bytes |
| Describe | field definitions/owners and observed names/counts/types/cardinality; focused producer-redacted samples only | 100 definitions and 100 observed fields; 20 exact enum values of at most 240 characters (empty remains valid); 3 opt-in samples of 80 characters; 256-character names; DTO 65,536 bytes |
| Todo read | exact canonical identities and hashes; root availability, state/issues; counts/omissions | 100 identities and 100 issues; issue descriptions 240 characters; paths 4,096 characters; hashes exactly `sha256:` + 64 lowercase hex; DTO 65,536 bytes |
| Todo recovery/mutation | allocation vs reservation, exact targets/hashes/preconditions, same-operation phase/recovery/rollback observations | 8 changed/possible references and 2 recovery receipts, with total/omitted; phase 64 characters; DTO 65,536 bytes |
| Every adapter | useful direct content and existing renderer facts | presentation 32,768 bytes; legacy details 65,536 bytes (oversize details retain renderer summary, not full rows) |

String ceilings use JS characters; aggregate ceilings use compact JSON UTF-8. Admitted identities are checked *before* clipping, never substituted. Descriptive clipping and row omissions are disclosed. Whole DTO overflow/schema/identity failure produces a bounded `ok:false` contract error with available conservative effects; it never repeats work. If required effect references cannot fit, effects remain possible and omitted-reference counts disclose the loss; withheld references are not actionable.

The existing search 100 prepared/returned rows and 20 related rows are domain/presentation bounds; body 1,200-character preview is a source-coverage/resource constraint. Describe's 20 focused fields/3 safe samples are disclosure bounds; distinct cardinality's 100-value cap is resource/coverage. All remain unchanged. Todo locks, journals, containment, queues and hashes remain domain/safety constraints. New delivery ceilings do not limit filesystem scan memory or input size.

## Outcomes and effects

Search/describe and completed todo list/validate/inspect are successful observations, even with invalid/conflicting findings. Allocation refusal and create/transition conflict/block are native failures (`isError:true`, `ok:false`). Missing service/host validation/block/abort without a native result can reject. Allocation is not creation or reservation: it runs lock-protected journal recovery and can change documents before a later refusal.

Canonical producer observations are invocation-local facts associated with the native result/error, not serialized service fields or persisted DTOs. Existing service/provider result shapes remain unchanged; providers lacking observations report unknown effects rather than invented no-effect claims. Recovery started/completed, stage, rollback and observed/possible document/cache effects survive later failure and projection failure. Cache effects include derived staging/journal/lock coordination state. Recovery receipts retain exact source/target and journal hashes plus observed current hashes (null means observed absence; missing means not observed), dispatched action and completion/failure. A previously published destination may be observed even when this invocation only cleans its journal. Unknown-provider recovery counters/rollback/reference accounting remain null/unknown, not invented zero/no-effect. Todo root availability is an observed present/missing state (unknown without a canonical observation); an unreadable/missing directory retains native failure, not a completed empty scan. Changed paths are exact observed references; overflow may withhold them explicitly. Completed rollback does not erase the fact work occurred. No receipt authorizes replay.

## Consumers

Codemode schema-declared calls resolve the DTO directly; check `ok` independently of rejected promises. `ctx.executeTool` returns Pi's outcome wrapper, not that DTO. For example:

```js
const result = await tools.project_todo_list({});
if (!result.ok) return { error: result.error, effects: result.effects };
return { paths: result.data.todos.map(todo => todo.path), completeness: result.completeness };
```

Small whole-result printing is valid. Ordinary content remains useful and independently bounded. Small legacy JSON stays intact in its first content block; a compact independent presentation receipt exposes native omissions and conservative effects to direct callers (not a persisted DTO copy). Existing details/renderers remain unchanged when within their ceiling; oversized details retain summary/count facts with explicit omission. Hooks may replace/drop native data; producer validation ends at the adapter. Execution-event DTOs are not promised in persisted transcript messages. No restoration or details duplication repairs that boundary.
