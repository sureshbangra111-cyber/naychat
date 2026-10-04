import { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/Badge';
import { Input, Textarea } from '../components/ui/Field';
import { apiRequest } from '../lib/api';
import { fetchSettings } from '../services/conversations';

/**
 * Admin settings (`/admin/settings`).
 *
 * Stored in the single-row `app_settings` table and applied immediately to the
 * customer chat (company name, welcome message, and a kill switch that stops
 * new conversations from starting).
 */
export function AdminSettingsPage() {
  const [companyName, setCompanyName] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [chatEnabled, setChatEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchSettings().then((settings) => {
      if (!active) return;
      setCompanyName(settings.company_name);
      setWelcomeMessage(settings.welcome_message);
      setChatEnabled(settings.chat_enabled);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // The server rejects this with 401 without a valid admin session.
      await apiRequest('/admin/settings', {
        method: 'PATCH',
        body: {
          companyName: companyName.trim() || 'Support Team',
          welcomeMessage: welcomeMessage.trim() || 'Hi 👋 How can we help you today?',
          chatEnabled,
        },
      });
    } catch (error) {
      // Raw database errors are never shown to the user.
      setError(
        error instanceof Error && error.message
          ? error.message
          : 'Settings could not be saved. Please try again.',
      );
      setSaving(false);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[settings]', error);
      }
      return;
    }

    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  }

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

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {saved ? (
            <span
              className="inline-flex items-center gap-1 text-sm text-emerald-600"
              role="status"
            >
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