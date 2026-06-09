import { z } from 'zod';
import { ImageSchema } from './Image.js';

export const ReligionSchema = z.object({
    image: ImageSchema.or(ImageSchema.array()).optional(),
    type: z.string().optional(),
    founded: z.string().optional(),
    headquarters: z.string().optional(),
    deities: z.array(z.string()).optional(),
});

export type Religion = z.infer<typeof ReligionSchema>;