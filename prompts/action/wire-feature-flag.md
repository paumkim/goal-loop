# Wire a Feature Flag

Add a feature flag named `<flag>` to this project using its existing config or
flag mechanism. Give it a safe default of off and add it to the env or config
samples. Guard the gated behavior at the narrowest sensible boundary so the old
path stays reachable when the flag is off. Test both the on and off states,
confirm the default is safe, and exercise the app with the flag toggled both
ways.

I should see the flag documented with its default and a removal condition so it
does not become permanent dead config.
