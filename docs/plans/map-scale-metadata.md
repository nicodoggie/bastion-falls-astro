# Map Scale Metadata

## Scope

Add a reusable map contract to `@bastion-falls/types` and optional `location.map` frontmatter for
all location kinds. Preserve existing `location.details.map` image metadata. Publish cropped
annotated regional maps without informational borders; archived originals remain unchanged. No
overlay UI, automatic registration, geographic redesign, or master-map migration is included.

## Contract

`MapSchema` contains `image: BaseImageSchema`. Optional `dimensions` contains positive integer
`width` and `height`, referring to the native displayed source asset. Optional `scale` contains
positive finite `pixels` and `distance`, a `unit` of `mile`, `kilometer`, `meter`, or `foot`,
`status` of `provisional` or `established`, and an optional provenance `note`. A scale requires
dimensions so its pixel frame is explicit. Image-only maps remain valid.

Calibration is a distance per span of native-image pixels, not a print ratio or screen-pixel scale.
Pure cropping preserves calibration; resampling requires conversion. The Gulf-of-Inespell world
scale remains provisional. The original Queilei vicinity registration is the evidence anchor;
returned scan calibration must account for the actual printed-sheet-to-scan transformation.

## Ownership

Ran owns shared schema, tests, exports, and Oranrakran metadata. Yomi owns the Rannek Marches crop,
article, and its asset calibration. One writer per file; review is read-only. No pushes or merges.

## Implementation and Verification

1. Add focused contract tests: metadata retention through political and natural location schemas,
   image-only compatibility, and invalid calibration rejection.
1. Confirm RED before implementation.
1. Add `Map.ts`, export it, and add optional `map` to `BaseLocationSchema`; preserve old fields.
1. Confirm GREEN, then run shared-types tests, typecheck, and build.
1. Add verified native dimensions and provisional scale to Oranrakran frontmatter. Match Rannek
   metadata to the same contract.
1. Probe the production collection schema against actual article frontmatter, checking retained
   values, then run MDX lint/formatting and Astro build. Inspect generated map references and
   dimensions. Commit only owned, verified changes; leave unrelated work untouched.
