# Developing artifact-profile providers

Artifact profiles let an independent package describe and validate domain-specific top-level Markdown frontmatter when both packages are active. Project artifacts remains schema-open: profiles enrich observed metadata with definitions, applicability, diagnostics, and confidence, but never grant permission to discover or exact-filter a field.

## Ownership boundary

`@aefree/pi-project-artifacts` owns:

- authoritative Markdown discovery and the disposable index;
- normalized exact matching for every supported top-level frontmatter field;
- the versioned `ArtifactProfileV1` contract and conformance helper;
- profile composition and agent-visible `raw_exact`, `profile_validated`, and `profile_warning` semantics.

A provider package owns:

- its field names, primitive types, enums, and artifact-kind hints;
- a narrow workspace applicability test based on direct domain evidence;
- validators and their diagnostic wording;
- provider lifecycle registration and cleanup;
- migrations or authoring guidance for its own schema, if any.

Do not add a provider's domain taxonomy to project artifacts. Do not make raw metadata filtering depend on the provider being installed.

## Package relationship

A provider that remains useful without project artifacts should declare it as an optional peer and as a development dependency for type checking and conformance tests:

```json
{
  "peerDependencies": {
    "@aefree/pi-project-artifacts": "^0.1.0"
  },
  "peerDependenciesMeta": {
    "@aefree/pi-project-artifacts": { "optional": true }
  },
  "devDependencies": {
    "@aefree/pi-project-artifacts": "^0.1.0"
  }
}
```

Pi packages have independent module roots. A separately installed provider must not require runtime identity through its own installed copy of project artifacts. Use type-only imports while developing the profile, and use the shared capability-registry protocol for runtime rendezvous.

## Profile shape

```ts
import type {
  ArtifactProfileV1,
  ArtifactValidationResultV1,
} from "@aefree/pi-project-artifacts/contracts/v1";

export function createDomainArtifactProfileV1(): ArtifactProfileV1 {
  return Object.freeze({
    contractVersion: 1,
    id: "example.domain-docs.v1",
    kind: "artifact-profile",
    owner: Object.freeze({
      packageName: "@example/pi-domain",
      packageVersion: "1.0.0",
      packageRoot: resolvePackageRoot(),
      registeredBy: "index.ts",
    }),
    artifactKinds: Object.freeze(["solution"]),
    fields: Object.freeze([
      {
        name: "domain_version",
        type: "string",
        indexed: true,
        filterable: true,
      },
    ]),
    validators: Object.freeze([
      {
        id: "example.domain-schema.v1",
        async validate(_context, request): Promise<ArtifactValidationResultV1> {
          if (request.signal.aborted) {
            return { outcome: "unavailable", code: "aborted", retryable: true };
          }
          return validateDomainArtifact(request.artifact);
        },
      },
    ]),
    async appliesTo(_context, request) {
      if (request.signal.aborted) return false;
      return hasDirectDomainEvidence(request.workspaceRoot);
    },
  });
}
```

Keep applicability narrower than a generic path convention. For example, a `docs/solutions/` path alone does not establish that a workspace belongs to a particular engine. Prefer a domain-owned manifest or project-settings file.

Validators receive a fresh invocation context and cancellation signal. They should return bounded, actionable issues and avoid mutation, process launches, network discovery, or implicit migrations. An `invalid` or `conflict` result contributes `profile_warning`; it does not suppress a raw exact metadata match.

## Optional runtime registration

Use the v1 registry key:

```ts
const ARTIFACT_PROFILE_REGISTRY_KEY_V1 =
  "@aefree/pi-project-artifacts/profiles/v1";
```

At extension load or session start:

1. Detect that the project-artifact integration is active, normally through the active `project_artifact_search` tool.
2. Lazily import the provider-owned profile implementation.
3. Rendezvous through the published capability-registry `globalThis[Symbol.for(...)]` protocol.
4. Register the profile against `ctx.sessionManager`.
5. Retain the exact registration token.
6. Unregister that token on session shutdown or extension reload.

Registration must be session-scoped and reverse-load-order safe. A delayed shutdown for an old session must not remove a newer session's record. If a provider registers several optional integrations transactionally, roll back earlier registrations when a later registration fails.

Absence is normal: the provider's primary tools must continue to load when project artifacts is not installed or its tools are disabled. Conversely, a malformed advertised registry is an installed-but-broken contract and should fail visibly rather than masquerading as absence.

## Validation

Use the exported conformance helper in provider tests:

```ts
import {
  assertArtifactProfileConformanceV1,
} from "@aefree/pi-project-artifacts/contracts/v1/conformance";

await assertArtifactProfileConformanceV1({
  createProfile: createDomainArtifactProfileV1,
  validArtifact: {
    path: "/fixture/docs/solutions/valid.md",
    kind: "solution",
    frontmatter: { domain_version: "1" },
  },
  invalidArtifact: {
    path: "/fixture/docs/solutions/invalid.md",
    kind: "solution",
    frontmatter: { domain_version: "unsupported" },
  },
});
```

Also test:

- provider-only and project-artifacts-only operation;
- both package load orders;
- applicable and non-applicable workspaces;
- session shutdown, reload, and delayed old-session cleanup;
- valid, invalid, conflict, unavailable, cancellation, and thrown-error behavior as applicable;
- raw exact matching when the profile is absent;
- `profile_validated` and `profile_warning` confidence when it is present;
- package installation and tarball contents without sibling `file:` links.

## Schema evolution

Treat profile IDs and metadata values as public compatibility boundaries once projects rely on them. Before adding a taxonomy:

- collect observed project fields with `project_artifact_describe`;
- distinguish stable retrieval fields from authoring-only prose conventions;
- avoid engine-agnostic names whose semantics are actually domain-specific;
- define whether old and new representations coexist, conflict, or require an owner-provided migration;
- keep migrations out of project artifacts itself.

A provider can register a useful profile incrementally, but should not publish speculative required fields or enums merely to make the integration appear complete.
