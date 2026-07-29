# Inkwell legality contract — schema 1

The optional `legality` artifact supplies format rules. The application falls
back to embedded Core defaults when the artifact is absent or invalid.

```json
{
  "schema_version": 1,
  "generated_at": "ISO-8601",
  "formats": {
    "core": {
      "effective_from": "YYYY-MM-DD",
      "minimum_deck_size": 60,
      "maximum_ink_colors": 2,
      "default_copy_limit": 4,
      "legal_sets": ["LOR7"],
      "banned_card_ids": [],
      "banned_full_names": [],
      "copy_limit_overrides": {}
    },
    "infinity": {}
  }
}
```

## Compatibility

- Canonical field: `maximum_ink_colors`.
- Compatibility adapter: the consumer also accepts the earlier draft field
  `maximum_inks`.
- Default when neither is valid: 2.
- No runtime third-party rules fetch is allowed.

## Single decision path

`validForDeck()` handles candidate-card mutations. `validateDeck()` provides
the authoritative full-deck result:

```json
{
  "legal": false,
  "total": 58,
  "reasons": ["..."],
  "badIds": ["LOR9-1"],
  "issues": [
    { "code": "MIN_SIZE", "message": "...", "card_id": null }
  ]
}
```

Issue codes are `UNKNOWN_DECK`, `OFF_COLOR`, `ROTATED`, `COPY_LIMIT`,
`MIN_SIZE`, and `MAX_INKS`.

Incomplete imports may be saved so players can finish a deck later.
Hard violations (`OFF_COLOR`, `ROTATED`, `COPY_LIMIT`, `MAX_INKS`) block import
before persistence and remain visible for correction.
