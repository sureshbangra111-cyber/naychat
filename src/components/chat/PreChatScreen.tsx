import { useState } from 'react';
import { Lock, SendHorizontal, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Spinner } from '../ui/Button';
import { Input, Textarea } from '../ui/Field';
import { MAX_MESSAGE_LENGTH } from '../../types/chat';

interface Props {
  companyName: string;
  welcomeMessage: string;
  sending: boolean;
  onStart: (input: {
    firstMessage: string;
    customerName?: string | null;
    customerPhone?: string | null;
  }) => Promise<boolean>;
}

/**
 * Pre-chat screen.
 *
 * No registration, no login, no mandatory personal data — name and phone are
 * strictly optional and can be left blank.
 */
export function PreChatScreen({ companyName, welcomeMessage, sending, onStart }: Props) {
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [touched, setTouched] = useState(false);

  const trimmed = message.trim();
  const tooLong = trimmed.length > MAX_MESSAGE_LENGTH;
  const valid = trimmed.length > 0 && !tooLong;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid || sending) return;

    const ok = await onStart({
      firstMessage: trimmed,
      customerName: name.trim() || null,
      customerPhone: phone.trim() || null,
    });
    if (ok) {
      setMessage('');
      setName('');
      setPhone('');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <div className="flex-1 overflow-y-auto px-5 py-8">
        <div className="mx-auto w-full max-w-lg">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{companyName}</p>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                We&apos;re here to help
              </p>
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">{welcomeMessage}</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Send us a message and our team will reply here.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            <div>
              <label htmlFor="first-message" className="sr-only">
                Your message
              </label>
              <Textarea
                id="first-message"
                name="first-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type your message..."
                autoFocus
                aria-invalid={touched && !valid ? true : undefined}
                className="min-h-[92px]"
              />
              {touched && trimmed.length === 0 ? (
                <p className="mt-1 text-xs text-rose-600">
                  Please type a message to start the chat.
                </p>
              ) : tooLong ? (
                <p className="mt-1 text-xs text-rose-600">
                  Please keep your message under {MAX_MESSAGE_LENGTH} characters.
                </p>
              ) : null}
            </div>

            {showDetails ? (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
                <Input
                  name="customer-name"
                  label="Name (optional)"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="How should we address you?"
                />
                <Input
                  name="customer-phone"
                  label="Phone (optional)"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  autoComplete="tel"
                  placeholder="+1 555 000 0000"
                />
                <p className="text-xs text-slate-500 sm:col-span-2">
                  Completely optional — you can chat without sharing anything.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="lg" loading={sending} disabled={!valid}>
                {!sending ? (
                  <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                ) : null}
                {sending ? 'Starting chat…' : 'Send message'}
              </Button>

              {!showDetails ? (
                <Button variant="ghost" onClick={() => setShowDetails(true)}>
                  Add my details
                </Button>
              ) : null}
            </div>

            <p className="flex items-start gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
              No account or password needed. Your conversation stays private to
              this device.
            </p>
          </form>

          <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Protected connection
            {sending ? <Spinner className="ml-1 h-3 w-3" /> : null}
          </p>
        </div>
      </div>
    </div>
  );
}