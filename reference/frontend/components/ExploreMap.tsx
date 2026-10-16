"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, {
  AttributionControl,
  Layer,
  Marker,
  NavigationControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import { Car, MapPin, TrainFront } from "lucide-react";
import {
  setWorkerUrl,
  type FilterSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { FitEvaluationResult, ResolvedSearchState } from "@fit/types.js";
import type {
  ExploreBootstrap,
  FrontendListing,
  GeoJsonFeatureCollection,
} from "@/lib/types";
import {
  accessibleZoneLabel,
  resultBand,
  type ActiveResultBand,
} from "@/lib/resultPresentation";
import {
  LISTING_DETAIL_FULL_ZOOM,
  LISTING_DETAIL_MIN_ZOOM,
  MAP_VISUAL_TOKENS,
  STANDARD_STATION_FULL_ZOOM,
  STANDARD_STATION_MIN_ZOOM,
  TRANSIT_LINE_GEOMETRY,
  transitStationTier,
  unavailableFootprintMessage,
  type UnavailableFootprintAnchor,
} from "@/lib/mapPresentation";

interface ExploreMapProps {
  bootstrap: ExploreBootstrap;
  exploreGrid: GeoJsonFeatureCollection;
  market: GeoJsonFeatureCollection | {
    type: "Feature";
    geometry: GeoJSON.Geometry;
    properties: Record<string, unknown>;
  };
  state: ResolvedSearchState;
  results: FitEvaluationResult[];
  activeResultBand: ActiveResultBand;
  selectedListingUid: string | null;
  localizeRequest: { listingUid: string; requestId: number } | null;
  pinnedListingUids: string[];
  debugGrid: boolean;
  limitsPresentation: boolean;
  footprintAvailable: boolean;
  footprintStatus: string;
  footprintUnavailableAnchors: UnavailableFootprintAnchor[];
  qaMode: boolean;
  mobileWorkspaceVisible: boolean;
  placementMode: "transit" | "car" | null;
  placementBusy: boolean;
  onSelectListing: (listingUid: string) => void;
  onMapReady: () => void;
  onMapIdle: () => void;
  onPlaceDestination: (selection: {
    longitude: number;
    latitude: number;
    cellId: string;
    cellCenterLongitude: number;
    cellCenterLatitude: number;
    routingMode: "transit" | "car";
  }) => void;
  onPlacementRejected: () => void;
}

setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/vendor/maplibre/maplibre-gl-worker.mjs`);

const FOOTPRINT_LAYER = {
  id: "explore-footprint",
  type: "fill" as const,
  paint: {
    "fill-color": MAP_VISUAL_TOKENS.personal,
    "fill-opacity": 0.22,
    "fill-outline-color": "rgba(42, 48, 46, 0)",
  },
  filter: ["==", ["get", "render_included"], true],
} satisfies LayerProps;

const GRID_DEBUG_LAYER = {
  id: "explore-grid-debug",
  type: "fill" as const,
  paint: {
    "fill-color": [
      "match",
      ["get", "routing_status"],
      "calculated_point",
      "#78c7aa",
      "network_coverage_missing",
      "#d15850",
      "route_unavailable_within_diagnostic_horizon",
      "#777d80",
      "search_only_explore_unavailable",
      "#c7ccca",
      "#e6aa4c",
    ] as const,
    "fill-opacity": 0.3,
    "fill-outline-color": "rgba(31, 42, 40, 0.2)",
  },
} satisfies LayerProps;

const GRID_PLACEMENT_LAYER = {
  id: "explore-grid-placement",
  type: "fill" as const,
  paint: {
    "fill-color": "#000000",
    "fill-opacity": 0.001,
  },
} satisfies LayerProps;

const MARKET_FILL_LAYER = {
  id: "market-fill",
  type: "fill" as const,
  paint: {
    "fill-color": "#f5f8f4",
    "fill-opacity": 0.08,
  },
} satisfies LayerProps;

const MARKET_LINE_LAYER = {
  id: "market-line",
  type: "line" as const,
  paint: {
    "line-color": "#174c3d",
    "line-width": 2,
    "line-opacity": 0.8,
  },
} satisfies LayerProps;

const CLUSTER_LAYER = {
  id: "listing-clusters",
  type: "circle" as const,
  filter: ["has", "point_count"],
  paint: {
    "circle-color": "#c8c1b5",
    "circle-radius": ["step", ["get", "point_count"], 12, 5, 15, 10, 18, 25, 22, 50, 26] as const,
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0.94, 12.2, 0.88, 13.2, 0.28] as const,
    "circle-stroke-color": "#f8f5ef",
    "circle-stroke-width": 1.5,
  },
} satisfies LayerProps;

const CLUSTER_COUNT_LAYER = {
  id: "listing-cluster-count",
  type: "symbol" as const,
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count_abbreviated"],
    "text-font": ["Noto Sans Regular"],
    "text-size": 10.5,
  },
  paint: {
    "text-color": "#262a28",
    "text-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 1, 12.2, 0.92, 13.2, 0.3] as const,
  },
} satisfies LayerProps;

const TRANSIT_LINE_CASING_LAYER = {
  id: "transit-line-casing",
  type: "line" as const,
  layout: {
    "line-cap": "round" as const,
    "line-join": "round" as const,
  },
  paint: {
    "line-color": "rgba(255, 253, 249, 0.92)",
    "line-width": ["interpolate", ["linear"], ["zoom"], 8.5, 4.2, 10.2, 4.8, 12.6, 6.2, 14.2, 7.2] as const,
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 8.5, 0.7, 10.2, 0.88] as const,
  },
} satisfies LayerProps;

const METRO_LINE_LAYER = {
  id: "metro-lines",
  type: "line" as const,
  filter: ["==", ["get", "mode"], "metro"],
  layout: {
    "line-cap": "round" as const,
    "line-join": "round" as const,
  },
  paint: {
    "line-color": ["get", "color"] as const,
    "line-width": ["interpolate", ["linear"], ["zoom"], 8.5, 2, 10.2, 2.4, 12.6, 3.2, 14.2, 3.8] as const,
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 8.5, 0.68, 10.2, 0.82, 12.6, 0.9] as const,
  },
} satisfies LayerProps;

const REM_LINE_LAYER = {
  id: "rem-lines",
  type: "line" as const,
  filter: ["==", ["get", "mode"], "rem"],
  layout: {
    "line-cap": "round" as const,
    "line-join": "round" as const,
  },
  paint: {
    "line-color": ["get", "color"] as const,
    "line-width": ["interpolate", ["linear"], ["zoom"], 8.5, 2.2, 10.2, 2.7, 12.6, 3.5, 14.2, 4] as const,
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 8.5, 0.72, 10.2, 0.86, 12.6, 0.92] as const,
  },
} satisfies LayerProps;

const PRIMARY_STATION_FILTER: FilterSpecification = ["==", ["get", "station_tier"], "primary"];
const STANDARD_STATION_FILTER: FilterSpecification = ["==", ["get", "station_tier"], "standard"];

const PRIMARY_TRANSIT_STATION_HALO_LAYER = {
  id: "primary-transit-station-halo",
  type: "circle" as const,
  filter: PRIMARY_STATION_FILTER,
  minzoom: 9.2,
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.2, 2.8, 12.6, 4.4] as const,
    "circle-color": "rgba(255,255,255,0.88)",
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.2, 0.68, 11.4, 0.9] as const,
  },
} satisfies LayerProps;

const PRIMARY_TRANSIT_STATION_LAYER = {
  id: "primary-transit-stations",
  type: "circle" as const,
  filter: PRIMARY_STATION_FILTER,
  minzoom: 9.2,
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.2, 1.25, 12.6, 2.5] as const,
    "circle-color": ["get", "display_color"] as const,
    "circle-stroke-color": ["get", "display_color"] as const,
    "circle-stroke-width": 0.8,
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.2, 0.76, 11.4, 0.96] as const,
  },
} satisfies LayerProps;

const STANDARD_TRANSIT_STATION_HALO_LAYER = {
  id: "standard-transit-station-halo",
  type: "circle" as const,
  filter: STANDARD_STATION_FILTER,
  minzoom: STANDARD_STATION_MIN_ZOOM,
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], STANDARD_STATION_MIN_ZOOM, 2.4, STANDARD_STATION_FULL_ZOOM, 4] as const,
    "circle-color": "rgba(255,255,255,0.88)",
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], STANDARD_STATION_MIN_ZOOM, 0, STANDARD_STATION_FULL_ZOOM, 0.86] as const,
  },
} satisfies LayerProps;

const STANDARD_TRANSIT_STATION_LAYER = {
  id: "standard-transit-stations",
  type: "circle" as const,
  filter: STANDARD_STATION_FILTER,
  minzoom: STANDARD_STATION_MIN_ZOOM,
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], STANDARD_STATION_MIN_ZOOM, 1.1, STANDARD_STATION_FULL_ZOOM, 2.25] as const,
    "circle-color": ["get", "display_color"] as const,
    "circle-stroke-color": ["get", "display_color"] as const,
    "circle-stroke-width": 0.8,
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], STANDARD_STATION_MIN_ZOOM, 0, STANDARD_STATION_FULL_ZOOM, 0.9] as const,
  },
} satisfies LayerProps;

function applyBasemapPolish(map: MapLibreMap): { waterLayers: number; parkLayers: number } {
  let waterLayers = 0;
  let parkLayers = 0;
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "fill") continue;
    const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "") : "";
    const descriptor = `${layer.id} ${sourceLayer}`.toLowerCase();
    if (descriptor.includes("water")) {
      map.setPaintProperty(layer.id, "fill-color", "#d5e2e3");
      map.setPaintProperty(layer.id, "fill-opacity", 0.82);
      waterLayers += 1;
      continue;
    }
    if (/park|grass|wood|forest|green/.test(descriptor)) {
      map.setPaintProperty(layer.id, "fill-color", "#e3e8dd");
      map.setPaintProperty(layer.id, "fill-opacity", 0.68);
      parkLayers += 1;
    }
  }
  return { waterLayers, parkLayers };
}

function resultCategory(result: FitEvaluationResult): string | null {
  const band = resultBand(result);
  return band === "excluded" ? null : band;
}

function listingGeoJson(
  listings: readonly FrontendListing[],
  results: readonly FitEvaluationResult[],
): FeatureCollection<Geometry, GeoJsonProperties> {
  const resultByUid = new globalThis.Map(results.map((result) => [result.listing_uid, result]));
  return {
    type: "FeatureCollection",
    features: listings.flatMap((listing) => {
      const longitude = listing.geography.longitude;
      const latitude = listing.geography.latitude;
      if (typeof longitude !== "number" || typeof latitude !== "number") return [];
      const result = resultByUid.get(listing.listing_uid);
      if (!result) return [];
      const category = resultCategory(result);
      if (category === null) return [];
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [longitude, latitude] },
        properties: {
          listing_uid: listing.listing_uid,
          result_category: category,
          fit_score: result.fit_score ?? null,
          canonical_rank: result.canonical_rank ?? null,
        },
      }];
    }),
  };
}

function transitStationGeoJson(
  stations: ExploreBootstrap["transit_stations"],
): FeatureCollection<Geometry, GeoJsonProperties> {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => {
      const route = station.routes.find((candidate) => candidate.route_color);
      const rawColor = route?.route_color?.replace(/^#/, "") ?? null;
      const displayColor = rawColor && /^[0-9a-f]{6}$/i.test(rawColor)
        ? `#${rawColor}`
        : station.mode === "rem"
          ? "#6f9791"
          : "#546d78";
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [station.longitude, station.latitude],
        },
        properties: {
          station_id: station.station_id,
          name: station.name,
          mode: station.mode,
          route_ids: station.route_ids.join(","),
          display_color: displayColor,
          station_tier: transitStationTier(station),
        },
      };
    }),
  };
}

function geometryCoordinates(geometry: GeoJSON.Geometry): number[][] {
  if (geometry.type === "Polygon") return geometry.coordinates.flat(1) as number[][];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2) as number[][];
  return [];
}

function boundsForMarket(market: ExploreMapProps["market"]): [[number, number], [number, number]] {
  const feature = market.type === "FeatureCollection" ? market.features[0] : market;
  if (!feature) return [[-74.2, 45.2], [-73.2, 46.0]];
  const coordinates = geometryCoordinates(feature.geometry);
  const longitudes = coordinates.map((coordinate) => coordinate[0]!).filter(Number.isFinite);
  const latitudes = coordinates.map((coordinate) => coordinate[1]!).filter(Number.isFinite);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

function boundsForPoints(
  points: readonly [number, number][],
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const longitudePadding = Math.max((east - west) * 0.08, 0.035);
  const latitudePadding = Math.max((north - south) * 0.08, 0.035);
  return [
    [west - longitudePadding, south - latitudePadding],
    [east + longitudePadding, north + latitudePadding],
  ];
}

function boundsForUsefulPoints(
  points: readonly [number, number][],
): [[number, number], [number, number]] | null {
  if (points.length < 20) return boundsForPoints(points);
  const longitudes = points.map(([longitude]) => longitude).sort((left, right) => left - right);
  const latitudes = points.map(([, latitude]) => latitude).sort((left, right) => left - right);
  const lowerIndex = Math.floor((points.length - 1) * 0.05);
  const upperIndex = Math.ceil((points.length - 1) * 0.95);
  return boundsForPoints([
    [longitudes[lowerIndex]!, latitudes[lowerIndex]!],
    [longitudes[upperIndex]!, latitudes[upperIndex]!],
  ]);
}

function motionDuration(duration: number): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
}

export default function ExploreMap({
  bootstrap,
  exploreGrid,
  market,
  state,
  results,
  activeResultBand,
  selectedListingUid,
  localizeRequest,
  pinnedListingUids,
  debugGrid,
  limitsPresentation,
  footprintAvailable,
  footprintStatus,
  footprintUnavailableAnchors,
  qaMode,
  mobileWorkspaceVisible,
  placementMode,
  placementBusy,
  onSelectListing,
  onMapReady,
  onMapIdle,
  onPlaceDestination,
  onPlacementRejected,
}: ExploreMapProps) {
  const mapRef = useRef<MapRef>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const basemapPolishRef = useRef({ waterLayers: 0, parkLayers: 0 });
  const resizeCountRef = useRef(0);
  const handledLocalizeRequestRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState<"grab" | "pointer">("grab");
  const [mapLoaded, setMapLoaded] = useState(false);
  const footprintLayer = useMemo(() => ({
    ...FOOTPRINT_LAYER,
    paint: limitsPresentation
      ? {
          ...FOOTPRINT_LAYER.paint,
          "fill-color": MAP_VISUAL_TOKENS.personal,
          "fill-opacity": 0.38,
        }
      : FOOTPRINT_LAYER.paint,
  }) satisfies LayerProps, [limitsPresentation]);
  const clusterLayer = useMemo(() => ({
    ...CLUSTER_LAYER,
    paint: {
      ...CLUSTER_LAYER.paint,
      "circle-color": activeResultBand === "near_miss" ? "#cbb9a5" : "#c8c1b5",
      "circle-opacity": limitsPresentation
        ? ["interpolate", ["linear"], ["zoom"], 9.5, 0.72, 12.2, 0.64, 13.2, 0.2] as const
        : CLUSTER_LAYER.paint["circle-opacity"],
      "circle-stroke-width": limitsPresentation ? 1 : 1.5,
    },
  }) satisfies LayerProps, [activeResultBand, limitsPresentation]);
  const clusterCountLayer = useMemo(() => ({
    ...CLUSTER_COUNT_LAYER,
    paint: {
      ...CLUSTER_COUNT_LAYER.paint,
      "text-opacity": limitsPresentation
        ? ["interpolate", ["linear"], ["zoom"], 9.5, 0.72, 12.2, 0.68, 13.2, 0.22] as const
        : CLUSTER_COUNT_LAYER.paint["text-opacity"],
    },
  }) satisfies LayerProps, [limitsPresentation]);
  const allListings = useMemo(
    () => listingGeoJson(bootstrap.listings, results),
    [bootstrap.listings, results],
  );
  const transitStations = useMemo(
    () => transitStationGeoJson(bootstrap.transit_stations),
    [bootstrap.transit_stations],
  );
  const listings = useMemo(() => {
    const category = activeResultBand === "matches" ? "match" : activeResultBand;
    return {
      type: "FeatureCollection" as const,
      features: activeResultBand === "unresolved"
        ? []
        : allListings.features.filter((feature) => feature.properties?.result_category === category),
    };
  }, [activeResultBand, allListings.features]);
  const selected = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: allListings.features.filter(
      (feature) => feature.properties?.listing_uid === selectedListingUid,
    ),
  }), [allListings.features, selectedListingUid]);
  const selectedCoordinates = useMemo(() => {
    const listing = bootstrap.listings.find((row) => row.listing_uid === selectedListingUid);
    const longitude = listing?.geography.longitude;
    const latitude = listing?.geography.latitude;
    return typeof longitude === "number" && typeof latitude === "number"
      ? [longitude, latitude] as [number, number]
      : null;
  }, [bootstrap.listings, selectedListingUid]);
  const anchorCoordinates = useMemo(
    () => state.anchors.flatMap((anchor) => {
      const longitude = anchor.resolved_longitude;
      const latitude = anchor.resolved_latitude;
      return typeof longitude === "number" && typeof latitude === "number"
        ? [[longitude, latitude] as [number, number]]
        : [];
    }),
    [state.anchors],
  );
  const pinned = useMemo(() => {
    const ids = new Set(pinnedListingUids);
    return {
      type: "FeatureCollection" as const,
      features: allListings.features.filter(
        (feature) => ids.has(String(feature.properties?.listing_uid)),
      ),
    };
  }, [allListings.features, pinnedListingUids]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    let animationFrame = 0;
    const resizeMap = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        map.resize();
        resizeCountRef.current += 1;
      });
    };
    const observer = new ResizeObserver(resizeMap);
    observer.observe(frame);
    resizeMap();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    if (!mobileWorkspaceVisible) return;
    const animationFrame = requestAnimationFrame(() => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      map.resize();
      resizeCountRef.current += 1;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [mobileWorkspaceVisible]);

  useEffect(() => {
    if (
      !mapLoaded ||
      !selectedCoordinates ||
      !localizeRequest ||
      localizeRequest.listingUid !== selectedListingUid ||
      handledLocalizeRequestRef.current === localizeRequest.requestId
    ) return;
    const map = mapRef.current;
    if (!map) return;
    handledLocalizeRequestRef.current = localizeRequest.requestId;
    const contextBounds = boundsForPoints([selectedCoordinates, ...anchorCoordinates]);
    if (contextBounds && anchorCoordinates.length > 0) {
      map.fitBounds(contextBounds, {
        padding: 70,
        maxZoom: 12.2,
        duration: motionDuration(480),
      });
      return;
    }
    map.easeTo({
      center: selectedCoordinates,
      zoom: Math.min(12.2, Math.max(map.getZoom(), 11.2)),
      duration: motionDuration(420),
      essential: false,
    });
  }, [anchorCoordinates, localizeRequest, mapLoaded, selectedCoordinates, selectedListingUid]);

  useEffect(() => {
    if (!qaMode) return;
    window.__FLINCY_MAP_QA__ = {
      project(longitude, latitude) {
        const point = mapRef.current?.project([longitude, latitude]);
        return point ? { x: point.x, y: point.y } : null;
      },
      focus(longitude, latitude, zoom = 14) {
        mapRef.current?.jumpTo({ center: [longitude, latitude], zoom });
      },
      firstCluster() {
        const feature = mapRef.current?.getMap().queryRenderedFeatures({ layers: ["listing-clusters"] })[0];
        if (!feature || feature.geometry.type !== "Point") return null;
        const point = mapRef.current?.project(feature.geometry.coordinates as [number, number]);
        return point ? { x: point.x, y: point.y } : null;
      },
      zoom() {
        return mapRef.current?.getZoom() ?? null;
      },
      center() {
        const center = mapRef.current?.getCenter();
        return center ? { longitude: center.lng, latitude: center.lat } : null;
      },
      cameraAudit() {
        const map = mapRef.current?.getMap();
        const center = map?.getCenter();
        return map && center ? {
          longitude: center.lng,
          latitude: center.lat,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        } : null;
      },
      resizeAudit() {
        const frame = frameRef.current?.getBoundingClientRect();
        const canvas = mapRef.current?.getMap().getCanvas().getBoundingClientRect();
        return {
          count: resizeCountRef.current,
          frameWidth: frame?.width ?? 0,
          frameHeight: frame?.height ?? 0,
          canvasWidth: canvas?.width ?? 0,
          canvasHeight: canvas?.height ?? 0,
        };
      },
      styleAudit() {
        const map = mapRef.current?.getMap();
        return {
          footprintFill: map?.getPaintProperty("explore-footprint", "fill-color") ?? null,
          footprintOpacity: map?.getPaintProperty("explore-footprint", "fill-opacity") ?? null,
          footprintOutline: map?.getPaintProperty("explore-footprint", "fill-outline-color") ?? null,
          metroLineColor: map?.getPaintProperty("metro-lines", "line-color") ?? null,
          remLineColor: map?.getPaintProperty("rem-lines", "line-color") ?? null,
          pinnedListingColor: map?.getPaintProperty("pinned-listing-points", "circle-color") ?? null,
          pinnedListingStroke: map?.getPaintProperty("pinned-listing-points", "circle-stroke-color") ?? null,
          selectedListingHaloRadius: map?.getPaintProperty("selected-listing-halo", "circle-radius") ?? null,
          selectedListingHaloColor: map?.getPaintProperty("selected-listing-halo", "circle-color") ?? null,
          selectedListingHaloStroke: map?.getPaintProperty("selected-listing-halo", "circle-stroke-color") ?? null,
          selectedListingRingRadius: map?.getPaintProperty("selected-listing-ring", "circle-radius") ?? null,
          selectedListingRingColor: map?.getPaintProperty("selected-listing-ring", "circle-color") ?? null,
          selectedListingCoreRadius: map?.getPaintProperty("selected-listing-core", "circle-radius") ?? null,
          selectedListingCoreColor: map?.getPaintProperty("selected-listing-core", "circle-color") ?? null,
          ...basemapPolishRef.current,
        };
      },
      layerAudit() {
        const map = mapRef.current?.getMap();
        const zoom = map?.getZoom() ?? 0;
        const rendered = (layerId: string) => map?.getLayer(layerId)
          ? map.queryRenderedFeatures({ layers: [layerId] }).length
          : 0;
        const relevantLayerIds = new Set([
          "explore-footprint",
          "transit-line-casing",
          "metro-lines",
          "rem-lines",
          "primary-transit-station-halo",
          "primary-transit-stations",
          "standard-transit-station-halo",
          "standard-transit-stations",
          "listing-clusters",
          "listing-cluster-count",
          "listing-halo",
          "listing-points",
          "pinned-listing-points",
          "selected-listing-halo",
          "selected-listing-ring",
          "selected-listing-core",
        ]);
        return {
          clusters: rendered("listing-clusters"),
          listings: zoom <= LISTING_DETAIL_MIN_ZOOM ? 0 : rendered("listing-points"),
          metroLines: rendered("metro-lines"),
          remLines: rendered("rem-lines"),
          primaryStations: rendered("primary-transit-stations"),
          standardStations: zoom <= STANDARD_STATION_MIN_ZOOM
            ? 0
            : rendered("standard-transit-stations"),
          pinnedListings: rendered("pinned-listing-points"),
          selectedListings: rendered("selected-listing-ring"),
          layerOrder: (map?.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((layerId) => relevantLayerIds.has(layerId)),
        };
      },
    };
    return () => {
      delete window.__FLINCY_MAP_QA__;
    };
  }, [qaMode]);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) basemapPolishRef.current = applyBasemapPolish(map);
    const listingPoints = bootstrap.listings.flatMap((listing) => {
      const longitude = listing.geography.longitude;
      const latitude = listing.geography.latitude;
      return typeof longitude === "number" && typeof latitude === "number"
        ? [[longitude, latitude] as [number, number]]
        : [];
    });
    // Initial framing describes the useful observed market while keeping every
    // outlying listing available by pan/zoom and in the public result set.
    mapRef.current?.fitBounds(boundsForUsefulPoints(listingPoints) ?? boundsForMarket(market), {
      padding: 44,
      duration: 0,
      maxZoom: 10.2,
    });
    setMapLoaded(true);
    onMapReady();
  }, [bootstrap.listings, market, onMapReady]);

  const handleClick = useCallback((event: MapLayerMouseEvent) => {
    if (placementMode) {
      if (placementBusy) return;
      const gridCell = event.features?.find(
        (feature) => feature.layer.id === "explore-grid-placement",
      );
      const cellId = gridCell?.properties?.cell_id;
      const centerLongitude = Number(gridCell?.properties?.center_longitude);
      const centerLatitude = Number(gridCell?.properties?.center_latitude);
      if (
        typeof cellId !== "string"
        || !Number.isFinite(centerLongitude)
        || !Number.isFinite(centerLatitude)
      ) {
        onPlacementRejected();
        return;
      }
      onPlaceDestination({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        cellId,
        cellCenterLongitude: centerLongitude,
        cellCenterLatitude: centerLatitude,
        routingMode: placementMode,
      });
      return;
    }
    const cluster = event.features?.find((feature) => feature.layer.id === "listing-clusters");
    if (cluster && cluster.geometry.type === "Point") {
      const clusterId = Number(cluster.properties?.cluster_id);
      const clusterCoordinates = cluster.geometry.coordinates as [number, number];
      const source = mapRef.current?.getMap().getSource("listings") as GeoJSONSource | undefined;
      if (source && Number.isFinite(clusterId)) {
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          mapRef.current?.easeTo({ center: clusterCoordinates, zoom });
        });
      }
      return;
    }
    const listing = event.features?.find((feature) =>
      ["listing-points", "pinned-listing-points", "selected-listing-ring"].includes(feature.layer.id)
    );
    const uid = listing?.properties?.listing_uid;
    if (typeof uid === "string") onSelectListing(uid);
  }, [onPlaceDestination, onPlacementRejected, onSelectListing, placementBusy, placementMode]);

  return (
    <div
      ref={frameRef}
      className="map-frame"
      data-testid="map-frame"
      data-clustering="maplibre-native"
      data-cluster-min-points="3"
      data-cluster-radius-steps="3:12|5:15|10:18|25:22|50:26"
      data-min-zoom="7.2"
      data-listing-detail-min-zoom={LISTING_DETAIL_MIN_ZOOM}
      data-listing-detail-full-zoom={LISTING_DETAIL_FULL_ZOOM}
      data-standard-station-min-zoom={STANDARD_STATION_MIN_ZOOM}
      data-standard-station-full-zoom={STANDARD_STATION_FULL_ZOOM}
      data-active-result-band={activeResultBand}
      data-normal-listing-count={listings.features.length}
      data-all-result-listing-count={allListings.features.length}
      data-market-boundary-visible={qaMode ? "true" : "false"}
      data-selected-count={selected.features.length}
      data-pinned-count={pinned.features.length}
      data-placement-mode={placementMode ?? "none"}
      data-transit-station-count={transitStations.features.length}
      data-transit-line-count={TRANSIT_LINE_GEOMETRY.features.length}
      data-limits-presentation={limitsPresentation ? "true" : "false"}
    >
      <MapGL
        ref={mapRef}
        mapStyle={bootstrap.attribution.basemap_style_url}
        initialViewState={{ longitude: -73.67, latitude: 45.58, zoom: 8.3 }}
        minZoom={7.2}
        attributionControl={false}
        interactiveLayerIds={placementMode
          ? ["explore-grid-placement"]
          : ["listing-clusters", "listing-points", "pinned-listing-points", "selected-listing-ring", "selected-listing-core"]}
        cursor={placementMode ? "crosshair" : cursor}
        onClick={handleClick}
        onMouseMove={(event) => {
          if (!placementMode) setCursor(event.features?.length ? "pointer" : "grab");
        }}
        onMouseLeave={() => setCursor("grab")}
        onLoad={handleLoad}
        onIdle={onMapIdle}
        reuseMaps
      >
        <AttributionControl
          compact
          position="bottom-right"
          customAttribution={[
            '<a href="https://www.stm.info/fr/a-propos/developpeurs" target="_blank" rel="noopener noreferrer">STM</a> · <a href="https://rem.info/fr/carte" target="_blank" rel="noopener noreferrer">REM</a> <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY</a>',
          ]}
        />
        <NavigationControl position="top-right" showCompass={false} />
        {qaMode && (
          <Source id="market" type="geojson" data={market as never}>
            <Layer {...MARKET_FILL_LAYER} />
            <Layer {...MARKET_LINE_LAYER} />
          </Source>
        )}
        <Source id="explore-grid" type="geojson" data={exploreGrid as never}>
          {placementMode ? <Layer {...GRID_PLACEMENT_LAYER} /> : null}
          {debugGrid
            ? <Layer {...GRID_DEBUG_LAYER} />
            : footprintAvailable
              ? <Layer {...footprintLayer} beforeId="transit-line-casing" />
              : null}
        </Source>
        <Source id="transit-lines" type="geojson" data={TRANSIT_LINE_GEOMETRY}>
          <Layer {...TRANSIT_LINE_CASING_LAYER} />
          <Layer {...METRO_LINE_LAYER} />
          <Layer {...REM_LINE_LAYER} />
        </Source>
        <Source id="transit-station-catalog" type="geojson" data={transitStations}>
          <Layer {...PRIMARY_TRANSIT_STATION_HALO_LAYER} />
          <Layer {...PRIMARY_TRANSIT_STATION_LAYER} />
          <Layer {...STANDARD_TRANSIT_STATION_HALO_LAYER} />
          <Layer {...STANDARD_TRANSIT_STATION_LAYER} />
        </Source>
        <Source id="listings" type="geojson" data={listings} cluster clusterMinPoints={3} clusterRadius={42} clusterMaxZoom={12}>
          <Layer {...clusterLayer} />
          <Layer {...clusterCountLayer} />
          <Layer
            id="listing-halo"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            minzoom={LISTING_DETAIL_MIN_ZOOM}
            paint={{
              "circle-radius": ["case", ["<=", ["coalesce", ["get", "canonical_rank"], 9999], 10], 8, 6],
              "circle-color": "rgba(255,255,255,0.9)",
              "circle-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                LISTING_DETAIL_MIN_ZOOM,
                0,
                LISTING_DETAIL_FULL_ZOOM,
                limitsPresentation ? 0.68 : 1,
              ],
              "circle-stroke-width": 0,
            }}
          />
          <Layer
            id="listing-points"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            minzoom={LISTING_DETAIL_MIN_ZOOM}
            paint={{
              "circle-radius": ["case", ["<=", ["coalesce", ["get", "canonical_rank"], 9999], 10], 5.5, 4],
              "circle-color": [
                "match",
                ["get", "result_category"],
                "match",
                MAP_VISUAL_TOKENS.market,
                "near_miss",
                MAP_VISUAL_TOKENS.consider,
                MAP_VISUAL_TOKENS.verify,
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": limitsPresentation ? 0.75 : 1,
              "circle-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                LISTING_DETAIL_MIN_ZOOM,
                0,
                LISTING_DETAIL_FULL_ZOOM,
                limitsPresentation ? 0.78 : 1,
              ],
              "circle-stroke-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                LISTING_DETAIL_MIN_ZOOM,
                0,
                LISTING_DETAIL_FULL_ZOOM,
                limitsPresentation ? 0.7 : 1,
              ],
            }}
          />
        </Source>
        <Source id="pinned-listings" type="geojson" data={pinned}>
          <Layer
            id="pinned-listing-points"
            type="circle"
            paint={{
              "circle-radius": 8,
              "circle-color": MAP_VISUAL_TOKENS.compare,
              "circle-stroke-color": MAP_VISUAL_TOKENS.compareStroke,
              "circle-stroke-width": 2,
            }}
          />
        </Source>
        <Source id="selected-listing" type="geojson" data={selected}>
          <Layer
            id="selected-listing-halo"
            type="circle"
            paint={{
              "circle-radius": 15.5,
              "circle-color": MAP_VISUAL_TOKENS.selectedHalo,
              "circle-opacity": 0.96,
              "circle-stroke-color": MAP_VISUAL_TOKENS.selected,
              "circle-stroke-width": 3,
              "circle-blur": 0.04,
            }}
          />
          <Layer
            id="selected-listing-ring"
            type="circle"
            paint={{
              "circle-radius": 10.5,
              "circle-color": MAP_VISUAL_TOKENS.selected,
              "circle-stroke-color": MAP_VISUAL_TOKENS.selectedHalo,
              "circle-stroke-width": 2,
            }}
          />
          <Layer
            id="selected-listing-core"
            type="circle"
            paint={{
              "circle-radius": 4.25,
              "circle-color": MAP_VISUAL_TOKENS.selectedCore,
              "circle-stroke-color": MAP_VISUAL_TOKENS.selectedHalo,
              "circle-stroke-width": 0.8,
            }}
          />
          <Layer
            id="selected-listing-rank"
            type="symbol"
            layout={{
              "text-field": ["concat", "#", ["to-string", ["coalesce", ["get", "canonical_rank"], "—"]]],
              "text-size": 11,
              "text-offset": [0, -2.25],
              "text-anchor": "bottom",
              "text-font": ["Noto Sans Regular"],
            }}
            paint={{
              "text-color": MAP_VISUAL_TOKENS.selectedCore,
              "text-halo-color": MAP_VISUAL_TOKENS.selectedHalo,
              "text-halo-width": 2,
            }}
          />
        </Source>
        {state.anchors.map((anchor) => {
          const presetAnchorId = String(anchor.preset_anchor_id);
          const manualSlot = String(anchor.criterion_instance_id).match(/manual_destination_(\d+)/)?.[1];
          const label = String(anchor.anchor_label ?? bootstrap.anchor_labels[presetAnchorId] ?? (manualSlot ? `Destination ${manualSlot}` : "Destination"));
          return (
            <Marker
              key={anchor.criterion_instance_id}
              longitude={Number(anchor.resolved_longitude)}
              latitude={Number(anchor.resolved_latitude)}
              anchor="bottom"
            >
              <div className="anchor-marker" title={label}>
                {anchor.routing_mode === "car" ? <Car size={18} /> : <TrainFront size={18} />}
              </div>
            </Marker>
          );
        })}
      </MapGL>
      {placementMode && (
        <div className="map-placement-banner" data-testid="map-placement-banner">
          {placementBusy ? "Chargement des temps de trajet…" : "Cliquez pour placer votre destination"}
        </div>
      )}
      <div className="map-legend" aria-label="Légende de la carte">
        {footprintAvailable && <span><i className="legend-swatch footprint" />{accessibleZoneLabel(state)}</span>}
        {activeResultBand === "matches" && <span><i className="legend-dot feasible" />Correspondances</span>}
        {activeResultBand === "near_miss" && <span><i className="legend-dot near" />À considérer</span>}
        {activeResultBand === "unresolved" && <span><i className="legend-dot unresolved" />À vérifier</span>}
        {pinnedListingUids.length > 0 && <span><i className="legend-dot pinned" />À comparer</span>}
        {state.anchors.length > 0 && <span><MapPin size={13} />{state.anchors.length} destination{state.anchors.length > 1 ? "s" : ""}</span>}
      </div>
      {!footprintAvailable
        && state.anchors.length > 0
        && footprintStatus !== "not_applicable_no_commute_constraint"
        && (
        <div className="map-capability-note" data-testid="explore-unavailable-note">
          {unavailableFootprintMessage(footprintUnavailableAnchors)}
          {qaMode && <small>{footprintStatus}</small>}
        </div>
      )}
    </div>
  );
}
