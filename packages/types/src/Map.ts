import { z } from "zod";
import { BaseImageSchema } from "./Image.js";

/** Measurements refer to native asset pixels, not rendered screen pixels. */
export const MapScaleSchema = z.object({
	pixels: z.number().positive(),
	distance: z.number().positive(),
	unit: z.enum(["mile", "kilometer", "meter", "foot"]),
	status: z.enum(["provisional", "established"]),
	note: z.string().optional(),
});

export const MapSchema = z
	.object({
		image: BaseImageSchema,
		dimensions: z
			.object({
				width: z.number().int().positive(),
				height: z.number().int().positive(),
			})
			.optional(),
		scale: MapScaleSchema.optional(),
	})
	.refine((map) => !map.scale || !!map.dimensions, {
		message: "Map scale requires native image dimensions",
		path: ["dimensions"],
	});

export type MapScale = z.infer<typeof MapScaleSchema>;
export type Map = z.infer<typeof MapSchema>;
