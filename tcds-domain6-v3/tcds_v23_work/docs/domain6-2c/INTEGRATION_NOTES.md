# Domain 6.2C — Integration Notes

How the policy slice was integrated into this repository, and how to reproduce the result.

## What was overlaid

The delivered package was verified against its own manifest before anything was copied:
29 of 29 files matched their recorded SHA-256 and byte count, and every target path was
new, so nothing was overwritten. 26 files were overlaid byte-identical, and the five
policy scripts from the package fragment were merged into the project manifest as the
only change to `package.json`.

Two of the 26 were then corrected, both under approval and both recorded in the change
records: the boundary check's path handling, and the reserved marker on the unwired policy
diagnostic card. The other 24 remain byte-identical to the delivery.

## Order of integration

The policy slice freezes capture implementation files, so the capture slice had to be
final first. The outstanding capture correction was merged before the policy overlay was
created, and the policy baseline is therefore the commit that carries the completed
capture slice.

## Reproducing certification

From the application directory:

```
export DOMAIN6_2B_BASELINE_SHA=<approved 6.2B baseline>
export DOMAIN6_2C_BASELINE_SHA=<commit before the 6.2C overlay>
npm ci
npm run scandit:prepare
npm run scandit:policy:certify
```

`scandit:prepare` generates the Scandit runtime from the pinned packages. It is required
on a clean checkout because the runtime is not committed, and the runtime and parity
checks inside the chain cannot pass without it.

`scandit:policy:certify` is the whole of Milestone 1 in one command. It runs the 6.2A
runtime chain, then the 6.2B capture chain, then the policy manifest, boundary check,
strict typecheck and unit tests for this slice, and finally the production build.

## Continuous integration

`.github/workflows/domain6-2c-scandit-policy-certification.yml` runs the same chain on
every pull request and on manual dispatch. It differs from the delivered template in five
ways, all recorded in CR-6.2C-03: both baselines are supplied and validated, the working
directory and dependency cache path point at the application, the Scandit runtime is
generated before the chain, the path filter is removed so the workflow can be a required
check, and the generated policy manifest is verified and retained as a build artifact.

The capture baseline is a documented constant in the workflow, and a repository variable
of the same name overrides it without editing the workflow. The policy baseline on a pull
request is the base commit of that pull request.

## Dependencies

This slice adds no dependency, changes no dependency version and adds no lockfile entry.
The only `package.json` change is the five policy scripts. The Scandit Web SDK stays at
the version pinned for the milestone, and the policy adapter does not import it.

## What this slice does not do

It does not import Scandit, construct capture settings, touch the camera or the capture
view, play feedback, call an API, run SQL, persist telemetry, resolve a warehouse entity,
or accept or reject a scan. It takes an authoritative configuration snapshot, validates it
against a source-controlled safety envelope, and returns the provider-neutral execution
policy the capture slice already knows how to execute.

Connecting a decode observation to a warehouse workflow is the next slice's work.

## Bundle effect

The policy adapter is not reachable from the application entry point yet, so it is not
included in the entry chunk. The production build is unchanged by this slice apart from
the normal variation of a rebuild: entry chunk about 539 kB, the scanner diagnostic route
about 329 kB loaded on demand, service worker precache 45 entries.
