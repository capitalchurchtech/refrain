## What does this PR do?


## Type of change
- [ ] Bug fix
- [ ] New provider (`providers/`)
- [ ] New storage backend (`storage/`)
- [ ] New slide splitter (`slide-splitters/`)
- [ ] New feature module (`modules/`)
- [ ] Core change (please explain why it needs to be core rather than a plugin)
- [ ] Docs only

## Checklist
- [ ] I read CONTRIBUTING.md (and CLAUDE.md, if an AI agent wrote or helped write this)
- [ ] If this touches credentials or auth, secrets stay out of `config.json` and any new `.env` variables are in `.env.example`
- [ ] I didn't add any telemetry, analytics, or phone home
- [ ] No vendor or provider name is hardcoded in shared code. New cross provider behavior is gated by a `static supportsX` or `displayName` capability on the base class, not a comparison against a specific `providerId` or `backendId`
- [ ] If this ships a stub (interface implemented, methods not), the README's "What's finished and what isn't" section or CONTRIBUTING.md says so. It isn't presented as done
- [ ] If it's visible in the browser, I ran it against a live dev server, not just a syntax check
- [ ] Lint passes
