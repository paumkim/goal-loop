# Add an End-to-End Test

Add an end-to-end test that drives the real app through a user-facing flow such as
sign-in, create-and-read, or checkout. Use the project's fixture or seed mechanism
for deterministic state. Drive the flow through its real interface and assert on
user-visible results rather than internals. Wait on conditions instead of fixed
sleeps, and confirm the test fails when the core behavior is broken.

I should be able to run it through the test runner and see it pass repeatedly
without flakes. Use local fixtures or mocks for third parties, never real
credentials.
