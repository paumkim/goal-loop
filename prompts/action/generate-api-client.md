# Generate an API Client

Generate the API client or shared types for this project from its existing spec
(OpenAPI, GraphQL, protobuf, or JSON Schema). The generated output should match
the contract and replace any hand-written copy that has drifted.

- Regenerate with the repo's own generator; never hand-edit generated files.
- Cover every endpoint and the error shapes the spec defines.
- Update call sites only where the contract changed and adjust their tests.
- Add a check that fails when generated code is stale.
- Typecheck and build the generated code and its consumers.
