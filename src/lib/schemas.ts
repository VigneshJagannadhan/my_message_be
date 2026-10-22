import { z } from 'zod';

export const nameSchema = z.string().trim().min(1).max(80);

// E.164 style: "+" then country code and number, 7 to 15 digits, no spaces.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in international format, e.g. +14155550123');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z.string().min(8).max(128);

export const idSchema = z.uuid();
