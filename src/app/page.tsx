"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type TabKey = "exams" | "notifications" | "resources" | "subscription";

interface Exam {
  id: string;
  title: string;
  category: string;
  open_date?: string | null;
  end_date?: string | null;
  source_url?: string | null;
}

const CATEGORIES = ["UPSC", "SSC", "Banking", "Railways"] as const;
const NAV_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "exams", label: "Exams" },
  { key: "notifications", label: "Notifications" },
  { key: "resources", label: "Resources" },
  { key: "subscription", label: "Subscription" },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("exams");
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const [trackUrl, setTrackUrl] = useState<string>("");
  const [trackCategory, setTrackCategory] = useState<string>(CATEGORIES[0]);
  const [tracking, setTracking] = useState<boolean>(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackSuccess, setTrackSuccess] = useState<boolean>(false);
  const [resourceSearch, setResourceSearch] = useState<string>("");
  const [readNotifs, setReadNotifs] = useState<Set<string>>(new Set<string>());

  const [email, setEmail] = useState<string>("");
  const [subscriptionCategories, setSubscriptionCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    CATEGORIES.forEach((c) => {
      initial[c] = true;
    });
    return initial;
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [subscriptionMessage, setSubscriptionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadExams = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from("exams").select("*").order("end_date", { ascending: true });
        if (!mounted) return;

        if (error) {
          console.error("Supabase error:", error.message);
          setExams([]);
        } else if (data) {
          setExams(data as Exam[]);
        }
      } catch (err) {
        console.error("Load exams failed:", err);
        setExams([]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadExams();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredExams = selectedCategory === "All" ? exams : exams.filter((exam) => exam.category === selectedCategory);
  const safeDate = (value?: string | null) => value?.split("T")[0] ?? "TBA";

  const toggleSubscriptionCategory = (category: string) => {
    setSubscriptionCategories((current) => ({ ...current, [category]: !current[category] }));
  };

  const handleSubscribe = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubscriptionMessage(null);

    try {
      const selected = Object.keys(subscriptionCategories).filter((category) => subscriptionCategories[category]);
      if (!email.trim() || selected.length === 0) {
        setSubscriptionMessage({ type: "error", text: "Please provide an email and select at least one category." });
        return;
      }

      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), categories: selected }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSubscriptionMessage({ type: "error", text: json.error || "Subscription failed." });
      } else {
        setSubscriptionMessage({ type: "success", text: "Subscription activated successfully." });
        setEmail("");
      }
    } catch (err) {
      console.error(err);
      setSubscriptionMessage({ type: "error", text: "Unable to reach subscription service." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrackSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTracking(true);
    setTrackError(null);
    setTrackSuccess(false);

    try {
      const response = await fetch("/api/track-custom-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trackUrl.trim(), category: trackCategory }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setTrackError(json.error || "Failed to submit portal.");
      } else {
        setTrackSuccess(true);
        setTrackUrl("");
      }
    } catch (err) {
      console.error(err);
      setTrackError("Unable to submit portal.");
    } finally {
      setTracking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            {/* National Emblem stylized insignia mark */}
            <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-blue-950 bg-blue-950 text-center">
              <span className="text-base leading-none">🏛</span>
              <span className="mt-0.5 block text-[5px] font-black uppercase tracking-widest text-amber-400 leading-none">GOI</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-orange-600">सत्यमेव जयते</span>
              <span className="text-sm font-semibold tracking-wide text-blue-950">ExamGov Notification Portal</span>
            </div>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className="relative flex flex-col items-center text-sm font-semibold text-gray-500 transition hover:text-gray-900"
                >
                  <span>{item.label}</span>
                  {isActive ? <span className="absolute bottom-[-10px] h-0.5 w-10 rounded-full bg-blue-600" /> : null}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Track Portal +
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        {activeTab === "subscription" ? (
          <div className="flex justify-center">
            <div className="w-full max-w-3xl rounded-2xl bg-[#003366] p-8 shadow-2xl">
              <h1 className="text-2xl font-bold text-white md:text-3xl">Never Miss a Registration Deadline</h1>
              <p className="mt-3 text-white/90">
                Get free, official email alerts tailored to your career goals. We only send notifications for the categories you select.
              </p>

              <form onSubmit={handleSubscribe} className="mt-6 space-y-5">
                <div>
                  <label htmlFor="subscription-email" className="block text-sm font-medium text-white/90">
                    Email Address
                  </label>
                  <div className="relative mt-2 rounded-md bg-white p-2">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">✉️</span>
                    <input
                      id="subscription-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="citizen@example.com"
                      required
                      className="w-full bg-transparent pl-10 text-sm text-gray-900 outline-none"
                    />
                  </div>
                </div>

                <fieldset>
                  <legend className="text-sm font-medium text-white/90">Select Categories for Alerts</legend>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {CATEGORIES.map((category) => (
                      <label key={category} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/20 px-3 py-2 text-white">
                        <input
                          type="checkbox"
                          checked={Boolean(subscriptionCategories[category])}
                          onChange={() => toggleSubscriptionCategory(category)}
                          className="h-4 w-4 rounded bg-white/10 text-blue-600"
                        />
                        <span className="text-sm">{category}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-md bg-[#0066cc] px-5 py-2 font-semibold text-white transition hover:bg-blue-500"
                  >
                    <span>🔔</span>
                    {submitting ? "Activating Alerts..." : "Activate Free Alerts 🔔"}
                  </button>
                </div>

                {subscriptionMessage ? (
                  <div className={`rounded-md px-4 py-2 text-sm ${subscriptionMessage.type === "success" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
                    {subscriptionMessage.text}
                  </div>
                ) : null}
              </form>
            </div>
          </div>
        ) : activeTab === "notifications" ? (
          (() => {
            // ── Static notification data ──────────────────────────────────────
            const NOTIFICATION_ITEMS = [
              {
                id: "notif-1",
                badge: "URGENT",
                badgeColor: "bg-red-100 text-red-700 border border-red-200",
                dotColor: "bg-red-500",
                title: "SSC CGL Registration Portal Closing Deadline Extended",
                source: "Staff Selection Commission",
                sourceShort: "SSC",
                date: "Today",
                description:
                  "The Staff Selection Commission has officially extended the Combined Graduate Level (CGL) 2025 online application registration closing date. Candidates who have not yet submitted their applications are advised to complete the process immediately before the revised final deadline.",
                attachmentLabel: "Download Official Extension Notice PDF",
                attachmentHref: "https://ssc.gov.in",
              },
              {
                id: "notif-2",
                badge: "NEW NOTICE",
                badgeColor: "bg-blue-100 text-blue-700 border border-blue-200",
                dotColor: "bg-blue-500",
                title: "UPSC Civil Services Prelims Detailed Syllabus PDF Released",
                source: "Union Public Service Commission",
                sourceShort: "UPSC",
                date: "Yesterday",
                description:
                  "UPSC has published the updated and detailed subject-wise syllabus document for the Civil Services (Preliminary) Examination 2026. The PDF covers General Studies Paper I and CSAT Paper II with revised topic weightings and recommended reading lists.",
                attachmentLabel: "Download Syllabus PDF",
                attachmentHref: "https://upsc.gov.in",
              },
              {
                id: "notif-3",
                badge: "RECRUITMENT",
                badgeColor: "bg-emerald-100 text-emerald-700 border border-emerald-200",
                dotColor: "bg-emerald-500",
                title: "IBPS RRB Officer Scale-1 Official Vacancy Matrix Revised",
                source: "Institute of Banking Personnel Selection",
                sourceShort: "IBPS",
                date: "3 days ago",
                description:
                  "IBPS has issued a corrigendum revising the state-wise and bank-wise vacancy distribution for RRB Officer Scale-1 2025. Candidates are advised to re-check their preferred posting zone eligibility and language proficiency requirements before the application window closes.",
                attachmentLabel: "Download Revised Vacancy Matrix PDF",
                attachmentHref: "https://www.ibps.in",
              },
            ];

            // ── Official press circulars ──────────────────────────────────────
            const PRESS_CIRCULARS = [
              {
                label: "PIB: DOPT Notification on Revised Central Government Service Rules 2026",
                date: "05 Jul 2026",
                href: "https://pib.gov.in",
                source: "PIB",
              },
              {
                label: "MoE Circular: National Scholarship Portal 2026 Application Window Open",
                date: "04 Jul 2026",
                href: "https://pib.gov.in",
                source: "MoE",
              },
              {
                label: "UPSC Press Release: Civil Services Interview Schedule — July 2026 Batch",
                date: "03 Jul 2026",
                href: "https://upsc.gov.in",
                source: "UPSC",
              },
              {
                label: "SSC Notice: Revised Exam Calendar for Second Half of 2026 Released",
                date: "02 Jul 2026",
                href: "https://ssc.gov.in",
                source: "SSC",
              },
              {
                label: "RBI: Grade B Officers Recruitment Notification 2026 — Phase I Dates",
                date: "01 Jul 2026",
                href: "https://www.rbi.org.in",
                source: "RBI",
              },
            ];

            // ── Derived counts ────────────────────────────────────────────────
            const markAsRead = (id: string) =>
              setReadNotifs((prev) => new Set<string>([...prev, id]));

            const unreadCount = NOTIFICATION_ITEMS.filter(
              (n) => !readNotifs.has(n.id)
            ).length;

            return (
              <div className="space-y-5">

                {/* ── Dashboard header ──────────────────────────────────────── */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-600">Notifications</p>
                    <div className="mt-0.5 flex items-center gap-3">
                      <h2 className="text-2xl font-bold text-gray-900">Live Notice Feed</h2>
                      {unreadCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                          {unreadCount} Unread {unreadCount === 1 ? "Circular" : "Circulars"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                          ✓ All caught up
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">Last updated: {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>

                {/* ── Two-column grid ───────────────────────────────────────── */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

                  {/* ── LEFT — Timeline feed (3/4) ────────────────────────── */}
                  <section className="lg:col-span-3">
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">

                      {/* Timeline list */}
                      <ul className="divide-y divide-gray-100">
                        {NOTIFICATION_ITEMS.map((notif, idx) => {
                          const isRead = readNotifs.has(notif.id);
                          return (
                            <li
                              key={notif.id}
                              className={`relative flex gap-4 p-5 transition-opacity ${
                                isRead ? "opacity-50" : "opacity-100"
                              }`}
                            >
                              {/* Timeline spine */}
                              <div className="flex flex-col items-center">
                                <span
                                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-2 ring-white ${notif.dotColor}`}
                                />
                                {idx < NOTIFICATION_ITEMS.length - 1 && (
                                  <div className="mt-1 w-px flex-1 bg-gray-200" />
                                )}
                              </div>

                              {/* Content */}
                              <div className="flex-1 pb-1">
                                {/* Top row: badge + date */}
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                      notif.badgeColor
                                    }`}
                                  >
                                    {notif.badge}
                                  </span>
                                  <span className="text-xs text-gray-400">{notif.source}</span>
                                  <span className="ml-auto text-xs font-medium text-gray-400">{notif.date}</span>
                                </div>

                                {/* Title */}
                                <h3 className="mt-2 text-sm font-bold leading-snug text-gray-900">
                                  {notif.title}
                                </h3>

                                {/* Description */}
                                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                                  {notif.description}
                                </p>

                                {/* Action row */}
                                <div className="mt-3 flex flex-wrap items-center gap-4">
                                  <a
                                    href={notif.attachmentHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition hover:text-blue-800"
                                  >
                                    <span>📎</span>
                                    {notif.attachmentLabel}
                                  </a>

                                  {!isRead ? (
                                    <button
                                      type="button"
                                      onClick={() => markAsRead(notif.id)}
                                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                                    >
                                      ✓ Mark as Read
                                    </button>
                                  ) : (
                                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                                      ✓ Read
                                    </span>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {/* Footer */}
                      <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 px-5 py-3">
                        <p className="text-xs text-gray-400">
                          Showing {NOTIFICATION_ITEMS.length} official circulars · Sourced from SSC, UPSC &amp; IBPS official portals.
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* ── RIGHT — Press circulars sidebar (1/4) ────────────── */}
                  <aside className="lg:col-span-1">
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                      <div className="border-b border-gray-100 px-5 py-4">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-blue-950">
                          <span>📡</span>
                          <span>Official Press Circulars</span>
                        </h3>
                        <p className="mt-0.5 text-xs text-gray-500">Latest PIB &amp; recruitment board releases</p>
                      </div>

                      <ul className="divide-y divide-gray-100">
                        {PRESS_CIRCULARS.map((item, idx) => (
                          <li key={idx} className="px-5 py-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                                  {item.source}
                                </span>
                                <p className="mt-1 text-xs leading-snug text-gray-800">{item.label}</p>
                                <p className="mt-1 text-[10px] text-gray-400">{item.date}</p>
                              </div>
                              <a
                                href={item.href}
                                target="_blank"
                                rel="noreferrer"
                                title="Download"
                                className="mt-0.5 shrink-0 text-blue-500 transition hover:text-blue-700"
                              >
                                ⬇
                              </a>
                            </div>
                          </li>
                        ))}
                      </ul>

                      <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 px-5 py-3">
                        <a
                          href="https://pib.gov.in"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                        >
                          View all PIB releases →
                        </a>
                      </div>
                    </div>
                  </aside>

                </div>
              </div>
            );
          })()
        ) : activeTab === "resources" ? (
          (() => {
            // ── Static resource data ────────────────────────────────────────
            const RESOURCE_CARDS = [
              {
                id: "syllabus",
                icon: "📋",
                title: "Syllabus & Blueprints",
                subtitle: "Official exam blueprints and sectional weightages",
                items: [
                  { label: "UPSC Civil Services – Full Syllabus", href: "https://upsc.gov.in/examinations/syllabus" },
                  { label: "SSC CGL Tier 1 & Tier 2 Blueprint", href: "https://ssc.gov.in/syllabus" },
                  { label: "Banking / IBPS PO Sectional Weights", href: "https://www.ibps.in/syllabus" },
                  { label: "RRB NTPC Subject-wise Breakdown", href: "https://www.rrbcdg.gov.in" },
                ],
                cta: "View Blueprint",
                ctaColor: "text-blue-600 hover:text-blue-800",
              },
              {
                id: "pyqs",
                icon: "📄",
                title: "Previous Year Papers",
                subtitle: "Authentic PYQs for structured revision",
                items: [
                  { label: "UPSC Prelims 2025 – GS Paper I & II", href: "https://upsc.gov.in/examinations/previous-question-papers" },
                  { label: "SSC CGL 2024 – All Shifts Combined", href: "https://ssc.gov.in/previous-papers" },
                  { label: "IBPS PO 2024 – Prelims & Mains", href: "https://www.ibps.in/previous-papers" },
                  { label: "RRB NTPC 2024 – CBT 1 Set", href: "https://www.rrbcdg.gov.in/previous-papers" },
                ],
                cta: "Download PDF",
                ctaColor: "text-emerald-600 hover:text-emerald-800",
              },
              {
                id: "strategy",
                icon: "🗺️",
                title: "Strategy Guides",
                subtitle: "Structured preparation roadmaps by toppers",
                items: [
                  { label: "6-Month UPSC Prelims Strategy 2026", href: "#" },
                  { label: "SSC Quantitative Aptitude Master Checklist", href: "#" },
                  { label: "Banking English & Reasoning Shortcuts", href: "#" },
                  { label: "Current Affairs 90-Day Revision Plan", href: "#" },
                ],
                cta: "Read Guide",
                ctaColor: "text-violet-600 hover:text-violet-800",
              },
            ];

            // ── Countdown exams ─────────────────────────────────────────────
            const COUNTDOWN_EXAMS = [
              { label: "UPSC Prelims 2026",   targetDate: "2026-05-24", color: "bg-blue-50 border-blue-200",   badge: "UPSC" },
              { label: "SSC CGL 2026",         targetDate: "2026-02-15", color: "bg-amber-50 border-amber-200",  badge: "SSC" },
              { label: "IBPS PO 2026",         targetDate: "2026-10-11", color: "bg-violet-50 border-violet-200", badge: "Banking" },
            ];

            function daysLeft(dateStr: string): number {
              const target = new Date(dateStr);
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              target.setHours(0, 0, 0, 0);
              return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
            }

            // ── Filter logic ────────────────────────────────────────────────
            const query = resourceSearch.toLowerCase().trim();
            const filteredCards = RESOURCE_CARDS.map((card) => ({
              ...card,
              items: query
                ? card.items.filter((item) => item.label.toLowerCase().includes(query))
                : card.items,
            })).filter((card) =>
              !query || card.title.toLowerCase().includes(query) || card.items.length > 0
            );

            return (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

                {/* ── LEFT — Main content (3/4) ───────────────────────────── */}
                <section className="space-y-6 lg:col-span-3">

                  {/* Search bar */}
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-gray-400">
                      🔍
                    </span>
                    <input
                      type="text"
                      value={resourceSearch}
                      onChange={(e) => setResourceSearch(e.target.value)}
                      placeholder="Search study materials…"
                      className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-sm text-gray-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    {resourceSearch && (
                      <button
                        type="button"
                        onClick={() => setResourceSearch("")}
                        className="absolute inset-y-0 right-4 flex items-center text-gray-400 hover:text-gray-700"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Header */}
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-600">Resources</p>
                    <h2 className="text-2xl font-bold text-gray-900">Preparation Hub</h2>
                    {query && (
                      <p className="mt-1 text-sm text-gray-500">
                        Showing results for <span className="font-semibold text-gray-700">&ldquo;{resourceSearch}&rdquo;</span>
                      </p>
                    )}
                  </div>

                  {/* 3-column resource card grid */}
                  {filteredCards.length === 0 ? (
                    <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
                      No resources matched &ldquo;{resourceSearch}&rdquo;. Try a different keyword.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                      {filteredCards.map((card) => (
                        <div
                          key={card.id}
                          className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
                        >
                          {/* Card header */}
                          <div className="mb-4 flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl">
                              {card.icon}
                            </span>
                            <div>
                              <h3 className="text-sm font-bold text-gray-900">{card.title}</h3>
                              <p className="text-xs text-gray-500">{card.subtitle}</p>
                            </div>
                          </div>

                          {/* Item list */}
                          <ul className="flex-1 space-y-2.5">
                            {card.items.map((item, idx) => (
                              <li key={idx} className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                                <span className="text-xs leading-snug text-gray-700">{item.label}</span>
                                <a
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`shrink-0 text-xs font-semibold transition ${card.ctaColor}`}
                                >
                                  {card.id === "pyqs" ? "⬇ " : ""}{card.cta}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── RIGHT — Countdown sidebar (1/4) ────────────────────── */}
                <aside className="lg:col-span-1">
                  <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-blue-950">
                      <span>⏱️</span>
                      <span>Exam Countdown Tracker</span>
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">Days remaining until registration deadlines</p>

                    <div className="mt-4 space-y-3">
                      {COUNTDOWN_EXAMS.map((exam) => {
                        const days = daysLeft(exam.targetDate);
                        const urgent = days <= 30;
                        const soon = days <= 90;
                        return (
                          <div
                            key={exam.label}
                            className={`rounded-xl border p-4 ${exam.color}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-600 shadow-sm">
                                {exam.badge}
                              </span>
                              {urgent && (
                                <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                  URGENT
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm font-semibold text-gray-900">{exam.label}</p>
                            <p className="text-xs text-gray-500">{exam.targetDate}</p>
                            <p
                              className={`mt-2 text-2xl font-extrabold tabular-nums ${
                                urgent ? "text-red-600" : soon ? "text-amber-600" : "text-blue-700"
                              }`}
                            >
                              {days}
                            </p>
                            <p className="text-xs font-medium text-gray-500">
                              {days === 1 ? "Day" : "Days"} Left
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Divider + study tip */}
                    <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
                      <p className="text-xs font-bold text-blue-800">💡 Daily Study Tip</p>
                      <p className="mt-1 text-xs leading-relaxed text-blue-700">
                        Consistent 4-hour daily sessions beat marathon study weekends. Prioritise weak areas identified in your last mock test.
                      </p>
                    </div>
                  </div>
                </aside>

              </div>
            );
          })()
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <aside className="lg:col-span-1">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="flex items-center gap-2 text-lg font-bold text-blue-950">
                  <span>⚡</span>
                  <span>Categories</span>
                </h3>

                <div className="mt-4 space-y-2">
                  {(["All", ...CATEGORIES] as string[]).map((category) => {
                    const isActive = selectedCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setSelectedCategory(category)}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                          isActive ? "bg-gray-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span>{category === "All" ? "⚡ All Exams" : `⚡ ${category}`}</span>
                        {isActive ? <span className="text-blue-600">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            <section className="lg:col-span-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-600">Exams</p>
                  <h2 className="text-2xl font-bold text-gray-900">Upcoming Examinations</h2>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] table-fixed text-left">
                    <thead>
                      <tr>
                        <th className="pb-3 text-sm font-semibold text-gray-500">Exam Name</th>
                        <th className="pb-3 text-sm font-semibold text-gray-500">Category</th>
                        <th className="pb-3 text-sm font-semibold text-gray-500">Start Date</th>
                        <th className="pb-3 text-sm font-semibold text-gray-500">Deadline</th>
                        <th className="pb-3 text-right text-sm font-semibold text-gray-500">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-500">
                            Loading exams...
                          </td>
                        </tr>
                      ) : filteredExams.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-500">
                            No exams found.
                          </td>
                        </tr>
                      ) : (
                        filteredExams.map((exam) => {
                          const startDate = safeDate(exam.open_date);
                          const deadline = safeDate(exam.end_date);
                          return (
                            <tr key={exam.id} className="border-t border-gray-100">
                              <td className="py-4 text-sm font-medium text-gray-900">{exam.title}</td>
                              <td className="py-4 text-sm text-gray-600">{exam.category}</td>
                              <td className="py-4 text-sm text-gray-600">{deadline}</td>
                              <td className="py-4 text-sm font-semibold text-gray-900">{startDate}</td>
                              <td className="py-4 text-right text-sm">
                                <a
                                  href={exam.source_url ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-block rounded bg-blue-600 px-3 py-1 font-semibold text-white transition hover:bg-blue-700"
                                >
                                  View
                                </a>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        )}

        {isModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
            <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-blue-600">Track Portal</p>
                  <h2 className="text-2xl font-bold text-gray-900">Add a new exam source</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full border border-gray-200 p-2 text-gray-600 transition hover:bg-gray-100"
                >
                  ✖
                </button>
              </div>

              <form onSubmit={handleTrackSubmit} className="space-y-4">
                <div>
                  <label htmlFor="track-url" className="block text-sm font-semibold text-gray-700">
                    Portal URL
                  </label>
                  <input
                    id="track-url"
                    type="url"
                    value={trackUrl}
                    onChange={(event) => setTrackUrl(event.target.value)}
                    required
                    placeholder="https://example.com/exam-notice"
                    className="mt-2 w-full rounded-md border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="track-category" className="block text-sm font-semibold text-gray-700">
                    Category
                  </label>
                  <select
                    id="track-category"
                    value={trackCategory}
                    onChange={(event) => setTrackCategory(event.target.value)}
                    className="mt-2 w-full rounded-md border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={tracking}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-70"
                  >
                    {tracking ? "Tracking…" : "Submit Portal"}
                  </button>
                </div>

                {trackError ? <p className="text-sm text-red-600">{trackError}</p> : null}
                {trackSuccess ? <p className="text-sm text-emerald-700">Portal submitted successfully.</p> : null}
              </form>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
