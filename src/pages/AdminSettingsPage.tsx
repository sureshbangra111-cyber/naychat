import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, FlaskConical, Megaphone, Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/Badge';
import { Input, Textarea } from '../components/ui/Field';
import { cn } from '../lib/utils';
import { isValidPixelId, resetMetaConfigCache } from '../lib/metaPixel';
import {
  fetchAdminSettings,
  saveAdminSettings,
  verifyMetaPixel,
  type MetaPixelVerification,
} from '../services/conversations';

/**
 * Admin settings (`/admin/settings`).
 *
 * Two sections in one form:
 *   1. Customer chat copy  — company name, welcome message, chat kill switch.
 *   2. Meta Ads tracking   — Pixel ID and an on/off toggle.
 *
 * SECURITY: the Pixel ID is validated twice — once here for immediate feedback,
 * and again on the server, which is the real gate. The value is only ever used as
 * a URL path segment by the tracker, so no code path here can turn it into
 * executable markup. The Conversions API access token is deliberately NOT part of
 * this form: it is a secret held in the server environment and is never readable
 * or editable through the API.
 */
export function AdminSettingsPage() {
  const [companyName, setCompanyName] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [chatEnabled, setChatEnabled] = useState(true);
  const [metaPixelId, setMetaPixelId] = useState('');
  const [metaTrackingEnabled, setMetaTrackingEnabled] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MetaPixelVerification | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const pixelError = useMemoError(metaPixelId);

  useEffect(() => {
    let active = true;
    void fetchAdminSettings()
      .then((settings) => {
        if (!active) return;
        setCompanyName(settings.company_name);
        setWelcomeMessage(settings.welcome_message);
        setChatEnabled(settings.chat_enabled);
        setMetaPixelId(settings.meta_pixel_id ?? '');
        setMetaTrackingEnabled(settings.meta_tracking_enabled);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('Settings could not be loaded. Please refresh and try again.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Client-side mirror of the server rule (digits only, 5-20). Used purely to
   * give immediate feedback; the server re-validates and is authoritative.
   */
  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    setTestError(null);

    try {
      await saveAdminSettings({
        companyName: companyName.trim() || 'Support Team',
        welcomeMessage: welcomeMessage.trim() || 'Hi 👋 How can we help you today?',
        chatEnabled,
        metaPixelId: metaPixelId.trim(),
        metaTrackingEnabled,
      });
      // Force the browser tracker to re-read the public config, so the change
      // takes effect on customer pages without a rebuild or redeploy.
      resetMetaConfigCache();
      setTestResult(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Settings could not be saved. Please try again.',
      );
      setSaving(false);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[settings]', err);
      }
      return;
    }

    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  }

  /**
   * "Test Pixel" — verifies configuration end to end WITHOUT any JavaScript and
   * WITHOUT a real Meta network call:
   *   1. the typed value is structurally valid,
   *   2. it is what MongoDB currently holds,
   *   3. `GET /api/public/config` serves exactly that to an anonymous browser.
   *
   * It deliberately does not touch the Conversions API access token.
   */
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await verifyMetaPixel(metaPixelId);
      setTestResult(result);
    } catch (err) {
      setTestError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not verify the Pixel configuration.',
      );
    } finally {
      setTesting(false);
    }
  }, [metaPixelId]);

  const configured = isValidPixelId(metaPixelId);
  const active = configured && metaTrackingEnabled;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          These values appear on the customer chat immediately.
        </p>
      </header>

      <form
        onSubmit={handleSave}
        noValidate
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        {/* ---------------- Customer chat ---------------- */}
        <fieldset className="space-y-5">
          <legend className="sr-only">Customer chat</legend>

          <Input
            name="company-name"
            label="Company name"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Acme Support"
            maxLength={60}
            hint="Shown in the chat header."
          />

          <Textarea
            name="welcome-message"
            label="Welcome message"
            value={welcomeMessage}
            onChange={(event) => setWelcomeMessage(event.target.value)}
            rows={2}
            maxLength={200}
            hint="The greeting a new visitor sees before their first message."
          />

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-4">
            <div>
              <label htmlFor="chat-enabled" className="text-sm font-medium text-slate-900">
                Accept new chats
              </label>
              <p className="mt-0.5 text-xs text-slate-500">
                When off, visitors can no longer start a conversation. Existing
                conversations stay readable.
              </p>
            </div>
            <input
              id="chat-enabled"
              name="chat-enabled"
              type="checkbox"
              checked={chatEnabled}
              onChange={(event) => setChatEnabled(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </fieldset>

        {/* ---------------- Meta Ads tracking ---------------- */}
        <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
          <legend className="sr-only">Meta Ads tracking</legend>

          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-slate-200">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Meta Ads Tracking</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Configure the Meta Pixel / Dataset used to measure ad conversions.
                Changes apply immediately — no rebuild or redeploy needed.
              </p>
            </div>
          </div>

          <Input
            name="meta-pixel-id"
            label="Meta Pixel ID"
            value={metaPixelId}
            onChange={(event) => setMetaPixelId(event.target.value)}
            placeholder="Paste your Meta Pixel / Dataset ID"
            maxLength={20}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            error={pixelError ?? undefined}
            hint="Enter your Meta Pixel / Dataset ID. Leave blank to disable Meta Pixel tracking."
          />

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <label htmlFor="meta-tracking-enabled" className="text-sm font-medium text-slate-900">
                Enable tracking
              </label>
              <p className="mt-0.5 text-xs text-slate-500">
                When off, the Meta Pixel is never loaded on customer pages.
              </p>
            </div>
            <input
              id="meta-tracking-enabled"
              name="meta-tracking-enabled"
              type="checkbox"
              checked={metaTrackingEnabled}
              disabled={!configured}
              onChange={(event) => setMetaTrackingEnabled(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          {/* Status */}
          <div
            className={cn(
              'flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm',
              active
                ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200',
            )}
          >
            {active ? (
              <>
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">Pixel configured</strong> — tracking is
                  active on customer pages.
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>
                  {configured ? (
                    <>
                      <strong className="font-semibold">Pixel not enabled</strong> — the ID
                      is saved but tracking is switched off.
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold">Pixel not configured</strong>
                      <span className="block text-xs text-slate-500">
                        Meta tracking is currently disabled.
                      </span>
                    </>
                  )}
                </span>
              </>
            )}
          </div>

          {/* Test Pixel */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleTest()}
              loading={testing}
              disabled={metaPixelId.trim().length === 0}
              icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              Test Pixel
            </Button>
            <span className="text-xs text-slate-500">
              Checks the ID format and that the public config serves it. Never contacts
              Meta.
            </span>
          </div>

          {testError ? <ErrorBanner message={testError} /> : null}

          {testResult ? (
            <div
              role="status"
              className={cn(
                'space-y-1.5 rounded-lg px-3 py-2.5 text-xs ring-1 ring-inset',
                testResult.servedMatches && testResult.savedMatches
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-amber-200',
              )}
            >
              <p className="font-semibold">Pixel verification</p>
              <ul className="space-y-0.5">
                <li>ID format: {testResult.validFormat ? 'valid' : 'invalid'}</li>
                <li>Saved in database: {testResult.saved ?? 'not set'}</li>
                <li>
                  Served by /api/public/config: {testResult.served ?? 'not set'}
                </li>
                <li>Tracking: {testResult.trackingEnabled ? 'enabled' : 'disabled'}</li>
              </ul>
              <p className="pt-1">
                {testResult.servedMatches && testResult.savedMatches
                  ? 'Configuration is consistent. Customer pages will load this Pixel.'
                  : 'Save your changes before testing so the saved value matches.'}
              </p>
            </div>
          ) : null}
        </fieldset>

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600" role="status">
              <Check className="h-4 w-4" aria-hidden="true" />
              Saved
            </span>
          ) : null}
        </div>

        {loading ? <p className="text-xs text-slate-400">Loading current settings…</p> : null}
      </form>
    </div>
  );
}

/** Local validation mirroring the server rule, for instant feedback. */
function useMemoError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!isValidPixelId(trimmed)) {
    // No example ID is embedded: the field must never ship a value that could be
    // mistaken for a configured Pixel.
    return 'Enter digits only — a Meta Pixel or Dataset ID contains no letters or symbols.';
  }
  return null;
}
