# Security Policy

Refrain handles credentials for outside services (ProPresenter's local API, and optionally Planning Center, Firestore, or SFTP). Please report security issues privately rather than as public GitHub issues.

## Reporting a vulnerability

Open a [private security advisory](../../security/advisories/new) on this repository, using GitHub's "Report a vulnerability" button under the Security tab. If that isn't available for some reason, email the maintainers listed in the repository description.

Please include:

- What the issue is and its potential impact.
- Steps to reproduce, if you have them.
- Which version or commit you tested against.

We'll acknowledge reports within a few days. This is a volunteer maintained project, so please be patient on fix timelines. We do take credential handling issues seriously given what this tool touches.

## Scope

In scope: anything to do with credential handling (`.env` handling, storage backend auth, provider auth), the SFTP hardening setup described in `docs/refrain-architecture.md`, and any code path that could leak a configured secret.

Out of scope: vulnerabilities in ProPresenter, Planning Center, Firestore, or any other third party service Refrain integrates with. Report those to the vendor.
