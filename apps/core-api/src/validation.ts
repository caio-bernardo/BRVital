import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Dados inválidos. Confira os campos e tente novamente.');
  return result.data;
}
export const idSchema = z.uuid();
