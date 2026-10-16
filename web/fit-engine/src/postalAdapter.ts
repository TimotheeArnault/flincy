import { FitEngineError } from "./evaluators.js";
import type {
  PostalAnchorCatalog,
  PostalAnchorRecord,
  PostalLookupResult,
} from "./types.js";

const CANADIAN_POSTAL_PATTERN =
  /^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTVWXYZ][0-9][ABCEGHJ-NPRSTVWXYZ][0-9]$/i;

export function normalizeCanadianPostalCode(input: unknown): string | null {
  const compact = String(input ?? "").toUpperCase().replace(/\s+/g, "");
  if (!CANADIAN_POSTAL_PATTERN.test(compact)) return null;
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export class PostalAnchorLookup {
  readonly catalog: PostalAnchorCatalog;
  readonly #byPostalCode: ReadonlyMap<string, PostalAnchorRecord>;

  constructor(catalog: PostalAnchorCatalog) {
    if (!catalog.schema_version || !Array.isArray(catalog.postal_anchors)) {
      throw new FitEngineError("Invalid postal anchor catalog");
    }
    const byPostalCode = new Map<string, PostalAnchorRecord>();
    for (const row of catalog.postal_anchors) {
      const normalized = normalizeCanadianPostalCode(row.postal_code);
      if (normalized === null || normalized !== row.postal_code) {
        throw new FitEngineError(`Postal catalog contains non-normalized code: ${row.postal_code}`);
      }
      if (byPostalCode.has(normalized)) {
        throw new FitEngineError(`Postal catalog contains duplicate code: ${normalized}`);
      }
      byPostalCode.set(normalized, row);
    }
    this.catalog = catalog;
    this.#byPostalCode = byPostalCode;
  }

  resolve(input: unknown): PostalLookupResult {
    const raw = input === null || input === undefined ? null : String(input);
    if (raw === null || raw.trim() === "") {
      return {
        input: raw,
        normalized_postal_code: null,
        lookup_status: "empty",
        anchor: null,
        engine_anchor_available: false,
      };
    }
    const normalized = normalizeCanadianPostalCode(raw);
    if (normalized === null) {
      return {
        input: raw,
        normalized_postal_code: null,
        lookup_status: "invalid",
        anchor: null,
        engine_anchor_available: false,
      };
    }
    const anchor = this.#byPostalCode.get(normalized) ?? null;
    if (anchor === null) {
      return {
        input: raw,
        normalized_postal_code: normalized,
        lookup_status: "unknown",
        anchor: null,
        engine_anchor_available: false,
      };
    }
    return {
      input: raw,
      normalized_postal_code: normalized,
      lookup_status: "resolved",
      anchor,
      engine_anchor_available:
        anchor.routing_coverage_status === "covered_by_500m_grid" &&
        anchor.matched_destination_cell_id !== null,
    };
  }
}
