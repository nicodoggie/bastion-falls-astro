import { z } from 'zod';

export const ReligionSchema = z.object({
    type: z.string().optional(),
    founded: z.string().optional(),
    headquarters: z.string().optional(),
    deities: z.array(z.string()).optional(),
});

export type Religion = z.infer<typeof ReligionSchema>;