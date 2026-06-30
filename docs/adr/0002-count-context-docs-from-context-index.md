# Count context docs from context index entries

Yog uses a multi-level index: the global routing index lists contexts, candidates, and ADRs, while each context has its own `contexts/<context-id>/index.json` for local capability and evidence details. The global context entry includes `docsCount`, defined as the number of countable local knowledge entries in that context index: `docsCount = capabilityCount + evidenceCountTotal`. `capabilityCount` is the number of `type: "capability"` entries, and `evidenceCountTotal` is the number of `type: "evidence"` entries in that context index.

`docsCount` counts capability/evidence-style knowledge items rather than physical files. It therefore excludes `CONTEXT.md`, context `README.md`, directory README files, templates, generated index files, and non-countable link entries such as `adr-link`; `inspect` should verify that the global `docsCount` matches the count of countable entries in the referenced context index.
