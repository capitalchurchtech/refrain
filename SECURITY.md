# Security policy

## Reporting a vulnerability

Please report security issues privately, not as public issues. Use GitHub's
**Report a vulnerability** button on this repository's Security tab to open a
private advisory. Include what the issue is and what it could lead to, how to
reproduce it, and the version or commit you tested.

We'll acknowledge a report within a few days. Refrain is maintained by
volunteers, so fixes can take longer, but issues that could expose a church's
credentials or let someone put content on a church's screens come first.

## What Refrain exposes

Knowing the design helps tell a bug from a known limit.

- **The booth screens** listen on `127.0.0.1` only. They have no sign-in: anyone
  who can run a program on the booth computer can use them. Requests that change
  anything are refused when they come from another site's page.
- **The phone page** is off until switched on. It listens on port 9997 on every
  network interface, over **plain HTTP**, with a daily PIN by default, a monthly
  device code for search and going live, approval by name for alerts, and rate
  limits on every sign-in path. A church can set no PIN, which lets anyone on the
  network see what's on the screens and add flags.
  [Phones](docs/phones.md#security) has the details.
- **Secrets** live in `.env` in the Refrain folder: Planning Center keys, the
  mail server login, the service feed key. A fixed phone PIN, if a church sets
  one, is in `config.json`. The secret behind phone sign-ins is in
  `data/remote-secret.json`, written readable only by its owner.
- **The MCP server** opens only ProPresenter file types, refuses ProPresenter's
  workspace database folders (checked after following links), and writes only to
  `data/probundle-staging` and the skills folder inside the Bundles packs
  folder.
- **Updates** run `git pull --ff-only` and `npm install` from the repository and
  the npm registry.

## In scope

- Getting past the phone page's PIN, device code, approval or rate limits.
- Reaching a booth-only route from the phone page or from another computer.
- Anything that leaks a secret from `.env`, the phone secret or a token into a
  log, a page, the service feed or a crash report.
- The MCP server opening or writing anything outside its rules.
- Anything that writes to ProPresenter's library or database.
- Credential handling in the providers, delivery backends and the SMTP client.

## Out of scope

- The phone page being plain HTTP, and the no-PIN option. These are documented
  limits. A report showing a practical attack that matters on a church network
  is still welcome.
- Someone with access to the booth computer's account. They can already read the
  Refrain folder.
- Vulnerabilities in ProPresenter, Planning Center or any other service Refrain
  talks to. Report those to the vendor.
