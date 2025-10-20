# Vehicle Stat Block Components

This project includes two components for displaying vehicle information in a
D&D Beyond-style stat block.

## Quick Usage (Recommended)

For use in MDX files, use the `VehicleStatBlock` component which automatically
fetches the vehicle data from the current page's frontmatter:

```mdx
---
title: La Carnalis
vehicle:
  type: galley
  travelPace: 10
  # ... rest of vehicle data
---

<VehicleStatBlock />
```

The component will automatically:
- Detect which vehicle page it's on from the URL
- Fetch the vehicle data from the content collection
- Display the vehicle name from the `title` field

## Advanced Usage

If you need more control, you can use the `VehicleCard` component directly in
`.astro` files:

```astro
---
import VehicleCard from '@/components/VehicleCard.astro';
import { getEntry } from 'astro:content';

const entry = await getEntry('vehicle', 'la-carnalis');
const vehicle = entry.data.vehicle;
---

<VehicleCard vehicle={vehicle} name={entry.data.title} />
```

Or with a custom vehicle object:

```astro
---
import VehicleCard from '@/components/VehicleCard.astro';

const customVehicle = {
  type: "airship",
  travelPace: 15,
  stats: { /* ... */ },
  capacity: { /* ... */ },
  crew: [ /* ... */ ],
  sections: [ /* ... */ ],
};
---

<VehicleCard vehicle={customVehicle} name="My Custom Vehicle" />
```

## Styling

The stat block uses D&D Beyond-inspired styling:
- Parchment-colored background in light mode
- Dark mode support
- Traditional serif fonts
- Color scheme matches D&D 5e stat blocks

## Data Structure

Vehicle data should follow the `VehicleSchema` from
`@bastion-falls/types/Vehicle`.

Required fields:
- `type`: Vehicle type (e.g., "sailing ship", "galley")
- `travelPace`: Miles per hour
- `stats`: Base stats (STR, DEX, CON, INT, WIS, CHA, size)
- `capacity`: Crew, passengers, cargo
- `crew`: Array of crew members with name and position

Optional fields:
- `sections`: Vehicle components (hull, sails, weapons, etc.)
  - Each section can have AC, HP, speed, actions, etc.

