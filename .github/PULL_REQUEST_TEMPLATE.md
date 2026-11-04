## What this changes


## Kind of change

- [ ] Bug fix
- [ ] New provider (`providers/`)
- [ ] New storage backend (`storage/`)
- [ ] New lyrics splitter (`slide-splitters/`)
- [ ] New delivery backend (`delivery/`)
- [ ] New or changed screen (`modules/`)
- [ ] Core change (say why it can't be a plugin)
- [ ] Docs only

## Checks

- [ ] I read CONTRIBUTING.md (and CLAUDE.md, if an AI agent wrote or helped with this)
- [ ] `npm test` passes, and new logic or new file writes have tests
- [ ] `npm run lint` is clean and `node --check` passes on every file I touched
- [ ] If it shows in the browser, I used it against a running Refrain
- [ ] Core search still works with nothing but ProPresenter
- [ ] No telemetry, analytics or reporting of any kind
- [ ] No vendor name in shared code: it reads `displayName` or a `supportsX` flag instead
- [ ] Secrets stay in `.env`, and any new name is in `.env.example`
- [ ] No real church data in code, tests, fixtures or screenshots
- [ ] Anything partly built is listed in the README's "What's finished and what isn't"
- [ ] If this changes `SCHEMA_VERSION`, the release notes will say the next reindex is a full rebuild
