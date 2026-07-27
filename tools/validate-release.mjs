// In-memory release-contract validator used by tools/validate.test.mjs.
//
// The filesystem-facing release gate is tools/validate_release.py. This module
// intentionally accepts a small host interface so deterministic fixtures can
// exercise the same contract without touching disk.

const SUPPORTED = {
  manifest: new Set([1]),
  cards: new Set([3]),
  cards_pt: new Set([1]),
  prices: new Set([2, 3, 4]),
  aliases: new Set([1]),
  validation: new Set([1]),
  price_history: new Set([1, 2, 3, 4]),
  legality: new Set([1]),
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[a-z]+:\/\//i.test(value)) return false;
  const parts = value.replaceAll('\\', '/').split('/');
  return !parts.includes('..');
}

function warningOrError(report, optional, message) {
  (optional ? report.warnings : report.errors).push(message);
}

export async function validateRelease(host) {
  const report = {
    ok: false,
    errors: [],
    warnings: [],
    info: {},
  };

  let manifest;
  try {
    manifest = JSON.parse(await host.readText('data-manifest.json'));
  } catch (error) {
    report.errors.push(`data-manifest.json: could not be read (${error.message})`);
    return report;
  }

  if (!SUPPORTED.manifest.has(manifest.manifest_version)) {
    report.errors.push(
      `data-manifest.json: unsupported manifest_version ${manifest.manifest_version}`,
    );
  }
  if (!manifest.generated_at) {
    report.warnings.push('data-manifest.json: missing generated_at');
  }

  const artifacts = manifest.artifacts || manifest.files || {};
  const schema = manifest.schema || {};
  const parsed = {};
  report.info.artifacts = Object.keys(artifacts).sort();

  for (const [kind, entryValue] of Object.entries(artifacts)) {
    const entry = entryValue && typeof entryValue === 'object' ? entryValue : {};
    const rel = entry.path;
    const optional = entry.optional === true;

    if (!safeRelativePath(rel)) {
      report.errors.push(`${kind}: unsafe or missing path ${JSON.stringify(rel)}`);
      continue;
    }

    let exists = false;
    try {
      exists = await host.exists(rel);
    } catch {
      exists = false;
    }
    if (!exists) {
      warningOrError(
        report,
        optional,
        `${kind}: ${optional ? 'optional artifact absent' : 'artifact missing'} (${rel})`,
      );
      continue;
    }

    if (entry.sha256) {
      try {
        const actual = String(await host.sha256(await host.bytes(rel))).toLowerCase();
        if (actual !== String(entry.sha256).toLowerCase()) {
          report.errors.push(
            `${kind}: sha256 mismatch (manifest ${String(entry.sha256).slice(0, 12)}… file ${actual.slice(0, 12)}…)`,
          );
        }
      } catch (error) {
        report.errors.push(`${kind}: sha256 could not be checked (${error.message})`);
      }
    }

    if (entry.bytes !== undefined) {
      try {
        const actualSize = await host.size(rel);
        if (actualSize !== entry.bytes) {
          report.errors.push(
            `${kind}: byte size mismatch (manifest ${entry.bytes} file ${actualSize})`,
          );
        }
      } catch (error) {
        report.errors.push(`${kind}: byte size could not be checked (${error.message})`);
      }
    }

    let value;
    try {
      value = JSON.parse(await host.readText(rel));
    } catch (error) {
      report.errors.push(`${kind}: not valid JSON (${error.message})`);
      continue;
    }
    parsed[kind] = value;

    if (Number.isInteger(schema[kind]) && value.schema_version !== schema[kind]) {
      report.errors.push(
        `${kind}: schema_version ${value.schema_version} != manifest.schema ${schema[kind]}`,
      );
    }
    if (SUPPORTED[kind] && !SUPPORTED[kind].has(value.schema_version)) {
      report.errors.push(`${kind}: schema_version ${value.schema_version} unsupported by app`);
    }
    if (!value.generated_at) {
      report.warnings.push(`${kind}: missing generated_at`);
    }
  }

  const cards = parsed.cards?.cards;
  const cardsById = new Map();
  if (Array.isArray(cards)) {
    for (const [index, card] of cards.entries()) {
      const cardId = card?.card_id;
      if (!cardId) {
        report.errors.push(`cards: cards[${index}] missing card_id`);
      } else if (cardsById.has(cardId)) {
        report.errors.push(`cards: duplicate card_id ${cardId}`);
      } else {
        cardsById.set(cardId, card);
      }
    }
    report.info.cards = cardsById.size;
  } else if ('cards' in artifacts) {
    report.errors.push('cards: no cards[] array');
  }

  const prices = parsed.prices?.prices || parsed.prices?.prices_by_liga_id;
  if (prices && typeof prices === 'object' && cardsById.size) {
    const orphanIds = Object.keys(prices).filter((cardId) => !cardsById.has(cardId));
    report.info.priced = Object.keys(prices).length;
    if (orphanIds.length) {
      report.warnings.push(
        `prices: ${orphanIds.length} priced ids absent from cards.json`,
      );
    }
  }

  const overlay = parsed.cards_pt?.cards;
  if (overlay && typeof overlay === 'object' && cardsById.size) {
    let orphanCards = 0;
    let orphanAbilities = 0;
    for (const [cardId, translated] of Object.entries(overlay)) {
      const baseCard = cardsById.get(cardId);
      if (!baseCard) {
        orphanCards += 1;
        continue;
      }
      const baseAbilityIds = new Set(
        (baseCard.abilities || []).map((ability) => ability?.ability_id).filter(Boolean),
      );
      for (const ability of translated?.abilities || []) {
        if (ability?.ability_id && !baseAbilityIds.has(ability.ability_id)) {
          orphanAbilities += 1;
        }
      }
    }
    if (orphanCards) {
      report.warnings.push(
        `cards_pt: ${orphanCards} overlay ids absent from cards.json (EN fallback)`,
      );
    }
    if (orphanAbilities) {
      report.warnings.push(
        `cards_pt: ${orphanAbilities} overlay abilities have no EN ability_id match`,
      );
    }
  }

  const history = parsed.price_history;
  if (history) {
    const series = history.series || history.history;
    if (!Array.isArray(series)) {
      report.errors.push('price_history: no series[]/history[]');
    } else {
      const malformed = series.filter(
        (snapshot) =>
          !snapshot ||
          typeof snapshot !== 'object' ||
          !ISO_DATE.test(String(snapshot.date || '')) ||
          !(snapshot.prices || snapshot.prices_by_liga_id),
      ).length;
      if (malformed) {
        report.errors.push(`price_history: ${malformed} malformed snapshots`);
      }
      report.info.history_points = series.length;
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}
