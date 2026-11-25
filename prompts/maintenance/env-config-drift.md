# Reconcile Env and Config Drift

Reconcile this repository's sample configuration with the variables the code actually reads. Find every variable read in source and config parsing, then compare it with what the sample files declare. Add empty, documented entries for variables the code reads but the sample omits, and remove or flag entries the code no longer reads. Update renamed variables in the sample and its docs, and confirm ignore rules keep real env files untracked while samples stay tracked. Never print real secret values, only names.
