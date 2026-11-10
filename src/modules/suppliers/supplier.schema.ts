import { z } from 'zod';
import { initialSupplierDetails, supplierDocuments, type SupplierDetails } from '../../../../lib/content/supplier-registration.ts';

const detailShape = Object.fromEntries(Object.keys(initialSupplierDetails).map(key => [key, z.string().trim().max(4000).default('')])) as Record<keyof SupplierDetails, z.ZodDefault<z.ZodString>>;
const selection = z.array(z.string().max(100)).max(30).refine(values => new Set(values).size === values.length, 'Duplicate choices');
export const supplierPayloadSchema = z.object({
  details: z.object(detailShape).strict(),
  types: selection, categories: selection, regions: selection,
  subcategories: z.record(z.string().max(100), selection).refine(value => Object.keys(value).length <= 10),
  documentExpiry: z.record(z.string().refine(key => supplierDocuments.some(doc => doc.id === key)), z.string().max(10)).default({}),
  accurate: z.boolean(), authorized: z.boolean(), privacy: z.boolean(),
}).strict();
