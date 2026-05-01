# Vehicle stat block (`VehicleStatBlock`)

Use `VehicleStatBlock` in MDX
(and `.astro`)
with ship data that matches `VehicleShipData` from
`@bastion-falls/5e-schema-zod` (5etools `vehicleShipData`).

## MDX usage

`VehicleStatBlock` is auto-imported for MDX
(see `astro-auto-import` in `astro.config.mjs`).
Pass `vehicle` from frontmatter; optional `name` overrides the header
(e.g. Starlight `title`).

```mdx
---
title: My Ship
vehicle:
  name: My Ship
  vehicleType: SHIP
  # …see help/5e-tools-schema/vehicle.mdx
---

{
// @ts-expect-error -- frontmatter is injected at runtime
frontmatter.vehicle && (
  <VehicleStatBlock vehicle={frontmatter.vehicle} name={frontmatter.title} />
) }
```

## `.astro` usage

```astro
---
import VehicleStatBlock from './VehicleStatBlock.astro';
import { getEntry } from 'astro:content';

const entry = await getEntry('vehicle', 'rozenmaiden');
const vehicle = entry?.data.vehicle;
---

{vehicle && (
  <VehicleStatBlock vehicle={vehicle} name={entry.data.title} />
)}
```

## Styling

Parchment-style card, dark mode tokens,
layout aligned with the site’s `StatBlock` presentation.
