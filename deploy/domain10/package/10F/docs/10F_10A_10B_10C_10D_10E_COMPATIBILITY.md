# 10F Compatibility with Approved 10A–10E

10F is additive under `src/domains/operations/domain10Certification/`.

All new tables use the `domain10_certification_*_10f` prefix. All new functions use `_10f` suffixes. 10F creates no prior-slice authoritative table and grants its runtime role no DML on 10A–10E tables.

The current production repository contains a generic `src/workers/certificationWorker.ts` for an existing platform workflow. 10F intentionally creates **no worker**, does not modify that file, and runs on demand through CI/QA/release tooling. This prevents semantic collision with current worker ownership.

10F reads prior-slice evidence and calls only read/verification functions such as the reviewed 10B authoritative policy resolver. It never invokes Graph/Telnyx execution, incident commands or 10E assurance evaluation.
