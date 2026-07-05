'use client';

import React, { useState } from 'react';

type CategoriesMap = { [k: string]: boolean };

export default function SubscriptionCard() {
  const [email, setEmail] = useState('');
  const [categories, setCategories] = useState<CategoriesMap>({ UPSC: true, SSC: true, Banking: false, Railways: false });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleCategoryCheckboxChange = (cat: string) => {
    setCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleSubscribe = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const selectedCats = Object.keys(categories).filter((k) => categories[k]);

    if (selectedCats.length === 0) {
      setMessage({ text: 'Please select at least one category to receive alerts.', type: 'error' });
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, categories: selectedCats }),
      });

      const result = await res.json();

      if (res.ok) {
        setMessage({ text: 'Alerts activated successfully! You will receive updates tailored to your goals.', type: 'success' });
        setEmail('');
      } else {
        setMessage({ text: result.error || 'Something went wrong. Please try again.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Failed to connect to the server.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-[#003366] text-white rounded-3xl p-8 md:p-10 shadow-2xl border border-white/10 overflow-hidden">
      <div className="max-w-4xl mx-auto grid gap-8">
        <div className="space-y-4">
          <h3 className="text-3xl md:text-4xl font-bold leading-tight">Never Miss a Registration Deadline</h3>
          <p className="text-base md:text-lg text-white/90 max-w-3xl">
            Get free, official email alerts tailored to your career goals. We only send notifications for the categories you select.
          </p>
        </div>

        <form onSubmit={handleSubscribe} className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 md:gap-8">
              <label className="text-sm font-semibold tracking-wide text-white/85" htmlFor="email">
                Email Address
              </label>
            </div>
            <div className="relative rounded-2xl border border-white/20 bg-white px-4 py-3 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20 transition-colors">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">mail</span>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="citizen@example.com"
                required
                className="w-full pl-11 pr-4 bg-transparent text-sm text-slate-900 outline-none"
              />
            </div>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-white/85">Select Categories for Alerts</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {['UPSC', 'SSC', 'Banking', 'Railways'].map((cat) => (
                <label key={cat} className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 cursor-pointer transition hover:border-white/30">
                  <input
                    type="checkbox"
                    checked={categories[cat]}
                    onChange={() => handleCategoryCheckboxChange(cat)}
                    className="h-5 w-5 rounded border-white/30 bg-slate-900 text-blue-500 focus:ring-blue-400"
                  />
                  <span className="text-sm font-medium text-white">{cat}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#0066cc] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#003366]/30 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="material-symbols-outlined">notifications_active</span>
            {submitting ? 'Activating Alerts...' : 'Activate Free Alerts'}
          </button>
        </form>

        {message && (
          <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-950'
              : 'bg-red-50 text-red-950'
          }`}>
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}
