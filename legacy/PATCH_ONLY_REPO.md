## Patch-only repository

This Git repository is **not** the original full product source repository.

- The original product is distributed as a Dockerized build.
- The full application source is not publicly released from this repository snapshot.
- This repository was initialized only to track the **2026-03-12 security hardening pass** and related review artifacts.

## What commit `009eabc` means

Commit `009eabc` should be treated as:

- a **partial/internal patch commit**
- a record of the security hardening changes made during this review pass
- **not** a full project snapshot suitable for public source publication

## Intended use

Use this repository for one of the following:

1. Internal review of the hardening work only
2. Exporting a patch/diff to apply onto the private source repository
3. Tracking follow-up hardening commits derived from this patch set

## Exported artifacts

The following files are intended for applying this work to the private source repository:

- `PRIVATE_SOURCE_PATCH_2026-03-12.patch`
- `PRIVATE_SOURCE_PATCH_SUMMARY_2026-03-12.md`

## Recommended workflow for the private source repo

1. Copy the patch artifacts into a safe internal workspace
2. Apply the patch to the private source repository
3. Resolve any path/context mismatches
4. Run build + regression checks
5. Verify these behaviors after apply:
	- `/sse` returns `401` without auth
	- dashboard live logs still work after login
	- webhook targets reject localhost/private IPs
	- debug force-key endpoint is disabled in prod

