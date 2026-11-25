# Drain the Merge Queue

Act as the repository's coordinator and drain the submitted work onto the integration branch. Use the project's merge flow to check the queue, then integrate each submitted item in order until the queue is empty. Let the flow take its lock and run its validation gates before each merge.

- Show the queue state and the integration branch state after each merge.
- Stop immediately on any failure and report which item failed and why.
- Never force progress with destructive operations or by bypassing validation.
- Promote to the release branch only if I explicitly ask and the sanctioned release process is followed.
