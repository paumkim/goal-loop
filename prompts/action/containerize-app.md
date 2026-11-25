# Containerize the App

Add a container build for this project and prove it serves a real request. Write
a Dockerfile using a multi-stage build where it reduces runtime size. Install
only production dependencies in the final stage and run as a non-root user where
practical. Add or update `.dockerignore` so local state, VCS data, and secrets
stay out of the build context. Build the image, start a container with safe local
values, and probe the app's health or root endpoint from the host.

If the project uses compose, add a service definition so local `up` and `down`
work. I should see a working image with no secrets baked into it and no leftover
containers.
