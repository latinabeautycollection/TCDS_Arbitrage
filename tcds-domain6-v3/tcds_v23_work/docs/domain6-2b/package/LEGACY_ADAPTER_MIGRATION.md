# Legacy scanditAdapter.ts Migration

The production PWA contains an old scanner placeholder at:

```text
src/lib/scanditAdapter.ts
```

Do not let certification delete it.

Implementation sequence:

1. search all source imports/references;
2. prove no production workflow still requires the placeholder;
3. remove it in a dedicated reviewed commit;
4. run existing Domain 6 regression tests;
5. run `npm run scandit:capture:verify-legacy`;
6. only then run full 6.2B certification.

If a production feature imports the placeholder, do not automatically rewrite
that feature from 6.2B. Record the consumer and resolve it through the approved
workflow-integration slice.
