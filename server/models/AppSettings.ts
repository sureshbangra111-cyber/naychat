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

    /**
     * META ADS TRACKING
     *
     * `metaPixelId` is the runtime source of truth for browser Pixel
     * configuration and is editable from Admin Settings. It is deliberately NOT a
     * build-time `VITE_*` variable, so changing it never requires a redeploy.
     *
     * Only a strictly numeric Meta Pixel / Dataset ID is accepted (validated by
     * `validateMetaPixelId`), and the value is only ever interpolated into the
     * official Meta loader URL as a path segment — never into a script body, so
     * it cannot become executable markup.
     *
     * The Conversions API access token is NOT stored here: it is a secret and
     * lives only in the server environment.
     */
    metaPixelId: { type: String, default: null, maxlength: 32 },
    metaTrackingEnabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type AppSettingsDoc = InferSchemaType<typeof appSettingsSchema>;
export const AppSettings = model('AppSettings', appSettingsSchema);

export const SETTINGS_KEY = 'default';
