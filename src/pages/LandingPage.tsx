import { Link } from 'react-router-dom';
import { ArrowRight, Clock, MessageCircle, ShieldCheck, Smartphone, Tag } from 'lucide-react';

const highlights = [
  {
    icon: MessageCircle,
    title: 'No sign-up needed',
    body: 'Tap through from an ad and start typing. No account, no password, no forms.',
  },
  {
    icon: Clock,
    title: 'Replies in minutes',
    body: 'Our team answers live during business hours, right here in the chat.',
  },
  {
    icon: Tag,
    title: 'Offers that follow you',
    body: 'Campaign links are remembered, so we know exactly which ad you saw.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by default',
    body: 'Your conversation is tied to this device only — no profiling, no tracking.',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <MessageCircle className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <span className="text-sm font-semibold text-slate-900">Support</span>
        </div>
        <Link
          to="/chat"
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          Chat with us
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-20">
        <section className="py-12 text-center sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Typical reply in under 5 minutes
          </span>

          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Chat with our team
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Ask a question about your order, your offer, or anything else. Start
            chatting right away — it takes one message, no registration required.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/chat"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:w-auto"
            >
              Start Chat
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              Works great on mobile
            </span>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <p className="text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Support. All rights reserved.
        </p>
      </footer>
    </div>
  );
}