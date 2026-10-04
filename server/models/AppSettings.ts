/**
 * Chat configuration — ported from the Supabase single-row `app_settings`.
 *
 * The SQL version was a one-row table with `id boolean primary key default true
 * check (id)`. That constraint has no meaning here, so this is a normal document
 * keyed by `key: 'default'`.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

const appSettingsSchema = new Schema(
  {
    key: { type: String, default: 'default', unique: true, index: true },
    companyName: { type: String, required: true, default: 'Support Team', maxlength: 120 },
    welcomeMessage: { type: String, required: true, maxlength: 500 },
    /** Kill switch: when false, visitors cannot start new conversations. */
    chatEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type AppSettingsDoc = InferSchemaType<typeof appSettingsSchema>;
export const AppSettings = model('AppSettings', appSettingsSchema);

export const SETTINGS_KEY = 'default';
