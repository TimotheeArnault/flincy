import { FitEngineError } from "./evaluators.js";

export interface RoutingFact {
  duration_seconds: number | null;
  diagnostic_duration_seconds: number | null;
  routing_status: string;
  route_pattern: string;
}

export type RoutingLookup = (
  routingLocationKey: string,
  routingMode: string,
  destinationCellId: string,
) => RoutingFact | null;

export interface CommonGridDocument {
  schema_version: string;
  grid_id: string;
  cell_order: string[];
  cell_order_hash: string;
}

export interface ColumnarRoutingShard {
  schema_version: string;
  routing_location_key: string;
  routing_mode: string;
  direction: string;
  cell_order_hash: string;
  dictionaries: {
    routing_status: string[];
    route_pattern: string[];
  };
  columns: {
    duration_seconds: Array<number | null>;
    diagnostic_duration_seconds: Array<number | null>;
    routing_status_code: number[];
    route_pattern_code: number[];
  };
}

export function decodeRoutingFact(
  shard: ColumnarRoutingShard,
  grid: CommonGridDocument,
  destinationCellId: string,
  indexByCell?: ReadonlyMap<string, number>,
): RoutingFact {
  if (shard.cell_order_hash !== grid.cell_order_hash) {
    throw new FitEngineError("Routing shard/common-grid order hash mismatch");
  }
  if (shard.direction !== "exact_location_origin_to_routing_baseline_cell_destination") {
    throw new FitEngineError(`Unsupported Search routing direction: ${shard.direction}`);
  }
  const index = indexByCell?.get(destinationCellId) ?? grid.cell_order.indexOf(destinationCellId);
  if (index === undefined || index < 0) {
    throw new FitEngineError(`Destination cell not found in common grid: ${destinationCellId}`);
  }
  const statusCode = shard.columns.routing_status_code[index];
  const patternCode = shard.columns.route_pattern_code[index];
  const status = statusCode === undefined ? undefined : shard.dictionaries.routing_status[statusCode];
  const pattern = patternCode === undefined ? undefined : shard.dictionaries.route_pattern[patternCode];
  if (status === undefined || pattern === undefined) {
    throw new FitEngineError(`Invalid routing dictionary code at cell ${destinationCellId}`);
  }
  return {
    duration_seconds: shard.columns.duration_seconds[index] ?? null,
    diagnostic_duration_seconds: shard.columns.diagnostic_duration_seconds[index] ?? null,
    routing_status: status,
    route_pattern: pattern,
  };
}
