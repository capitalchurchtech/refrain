# Security Policy

Refrain handles credentials for external services (ProPresenter's local API, optionally Planning Center, Firestore, or SFTP). Please report security issues privately rather than as public GitHub issues.

## Reporting a vulnerability

Open a [private security advisory](../../security/advisories/new) on this repository (GitHub's "Report a vulnerability" feature under the Security tab). If that's not available for any reason, email the maintainers listed in the repository description.

Please include:
- A description of the issue and its potential impact
- Steps to reproduce, if applicable
- Which version/commit you tested against

We'll acknowledge reports within a few days. Since this is a volunteer-maintained project, please be patient on fix timelines — but we take credential-handling issues seriously given what this tool touches.

## Scope

In scope: anything related to credential handling (`.env` handling, storage backend auth, provider auth), the SFTP hardening setup described in `docs/refrain-architecture.md`, and any code path that could leak configured secrets.

Out of scope: vulnerabilities in ProPresenter, Planning Center, Firestore, or any other third-party service Refrain integrates with — report those to the respective vendor.
