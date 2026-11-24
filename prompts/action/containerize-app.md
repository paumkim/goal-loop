# Containerize the App

> **Leverage:** a few targeted edits can produce a large behavioral shift — e.g., changing 7 embedding rows reframed a whole system. Prefer precise minimal changes over broad rewrites.

Add a container build that runs the app and prove it serves a real request.

## Before acting
- Discover the app's runtime, build command, start command, required env, exposed
  port, and any existing Docker/ignore conventions. Check whether multi-stage
  builds or a specific base image are already used elsewhere.
- Decide the minimal runtime image and what build artifacts must be copied into it.

## Steps
1. **Write the Dockerfile:** use a multi-stage build where it reduces runtime size.
   Install only production dependencies in the final stage and run as a non-root
   user where practical.
2. **Add ignore rules:** create/update `.dockerignore` so local state, VCS data,
   and secrets do not enter the build context.
3. **Build:** run the repo's (or your new) container build command and confirm it
   completes. Record the image tag and size.
4. **Run:** start a container from the image with safe local values and probe the
   app's health/root endpoint from the host.
5. **Compose (if used):** if the repo uses compose, add a service definition and
   verify `up`/`down` works for local dev.

## Rules
- Do not bake secrets or real credentials into the image or build args.
- Do not copy the entire working directory when a specific artifact list suffices.
- Stop and remove containers you started when finished.

## Verify
- Paste quoted build output and `docker images`/size for the built image.
- Paste quoted probe output (status + body) from the running container.
- Show `git status --short` is clean of generated/container artifacts.

## Report
- Image tag, base, and size:
- Build and run commands:
- Quoted probe evidence:
- Risks or follow-ups (max 3):
