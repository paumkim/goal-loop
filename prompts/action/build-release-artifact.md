# Build and Smoke-Test a Release Artifact

Build this project's real distributable and prove the artifact itself runs. Use
the project's own build or release command with production settings, and identify
the artifact type (binary, package, bundle, or container image). Inspect the
output, then run or launch the artifact directly, not the source tree. Verify a
real behavior such as version output, a health request, or a small workflow. For
a container image, run it and probe the service.

I should be able to confirm the artifact works with no secrets in build args or
logs, and the tree should stay clean of generated output.
