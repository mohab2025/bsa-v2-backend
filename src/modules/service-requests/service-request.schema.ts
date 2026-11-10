import { z } from 'zod';

export const serviceRequestSchema = z.object({
  name: z.string().trim().max(200), role: z.string().trim().max(200).default(''),
  clientType: z.string().max(200), phone: z.string().trim().max(200), email: z.string().trim().max(200),
  serviceSlug: z.string().max(200).default(''), notes: z.string().trim().max(4000).default(''),
}).strict();
