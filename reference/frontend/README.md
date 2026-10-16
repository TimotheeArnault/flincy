# Frontend source reference

This directory contains five selected source files from the real Flincy frontend:
lib/searchState.ts, lib/fitRuntime.ts, components/DecisionFocus.tsx,
components/ListingDetail.tsx and components/ExploreMap.tsx. They illustrate search
state resolution, the O4 runtime bridge, decision controls, listing explanations
and the relationship between prepared data and map layers.

These are inspectable sources, not a standalone or compilable frontend. React,
Lucide, react-map-gl/MapLibre and GeoJSON types are not installed here. The @fit/
and @/ aliases are not configured. Frontend types, exploreProjection, frontendDa,
resultPresentation, mapPresentation, TrajectoryControlParts and PinAction are
intentionally absent, as are styles, application wiring and configuration.
No Next.js execution or build command is provided for this directory.

No O3 bundle, MapLibre worker/vendor assets, transit geometry, listing data or
routing matrices are included. External attribution links and the general map
camera in ExploreMap are source code, not a distribution of their referenced
datasets. The preserved attribution text does not establish redistribution rights.

All five source files are byte-identical to their Git blobs at source commit
4f8919f8b3acbb70f9869dfb9839989306fb27cf. This statement concerns the selected
source snapshot only; it does not claim byte-level identity with the live site.
This local assembly is private and is not an authorization to publish.
