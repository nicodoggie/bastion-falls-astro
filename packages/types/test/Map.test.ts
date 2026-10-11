import assert from "node:assert/strict";
import test from "node:test";
import { LocationSchema } from "../src/Location.js";
import { MapSchema } from "../src/Map.js";

const map = {
	image: {
		url: "../../../../assets/maps/example.png",
		alt: "An annotated regional map",
	},
	dimensions: { width: 1910, height: 1670 },
	scale: {
		pixels: 312,
		distance: 10,
		unit: "mile",
		status: "provisional",
		note: "Synthetic calibration fixture, not a real map measurement.",
	},
};

test("map metadata survives both political and natural location parsing", () => {
	for (const type of ["region", "basin"]) {
		assert.deepEqual(LocationSchema.parse({ type, map }).map, map);
	}
});

test("image-only maps and existing political details.map remain compatible", () => {
	const image = { url: "old-map.png", alt: "Existing map" };
	assert.deepEqual(MapSchema.parse({ image }), { image });
	const location = LocationSchema.parse({
		type: "region",
		details: { map: image },
	});
	assert.equal(location.type, "region");
	if (location.type === "region")
		assert.deepEqual(location.details?.map, image);
});

test("calibration requires a native pixel frame and positive finite measurements", () => {
	assert.equal(
		MapSchema.safeParse({ image: map.image, scale: map.scale }).success,
		false,
	);
	for (const pixels of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(
			MapSchema.safeParse({ ...map, scale: { ...map.scale, pixels } }).success,
			false,
		);
	}
	assert.equal(
		MapSchema.safeParse({ ...map, scale: { ...map.scale, distance: 0 } })
			.success,
		false,
	);
	assert.equal(
		MapSchema.safeParse({ ...map, scale: { ...map.scale, unit: "inch" } })
			.success,
		false,
	);
	assert.equal(
		MapSchema.safeParse({ ...map, dimensions: { width: 1.5, height: 10 } })
			.success,
		false,
	);
});
