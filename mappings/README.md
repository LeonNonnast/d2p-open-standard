# mappings/

Versioned mappings between the canonical D2P model and external ontologies, standards and industry conventions. Mappings declare their provenance and version; they translate to and from the canonical model rather than replacing it.

Each mapping is a `d2p:mapping-profile` document (`schemas/core/mapping-profile.schema.json`, catalog §3.1) stored as `mappings/<local-name>-<version>.json` after its `mappingId` and `version`. It names the external system and the edition it refers to (`system`, `systemVersion`), declares its `provenance`, and lists entries that relate a D2P identifier or vocabulary term to an external term (`exact`, `close`, `broader`, `narrower`, `related`, after the SKOS mapping properties). Entries are sorted by `d2pTerm`, then `externalTerm`. Mappings are informative: no reference resolves through them, and they carry no copied normative text or tables of the external system. `npm run validate` validates every file here against the schema.

No mapping has been published yet. Mappings to ISO 8559-1 or ASTM D5219 wait for an edition and licence check (catalog §5). See `examples/core/mapping-profile/` for the format.
