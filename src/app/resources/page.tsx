'use client';

import Link from 'next/link';

interface ResourceCard {
  title: string;
  description: string;
  href: string;
  badge: string;
}

const resources: ResourceCard[] = [
  {
    title: 'UPSC Syllabus PDF',
    description: 'Official UPSC Civil Services syllabus and exam pattern references.',
    href: 'https://upsc.gov.in/sites/default/files/Notification-CSP-2025.pdf',
    badge: 'UPSC',
  },
  {
    title: 'SSC Previous Year Papers',
    description: 'Download SSC CGL and CHSL question papers for focused practice.',
    href: 'https://ssc.nic.in/',
    badge: 'SSC',
  },
  {
    title: 'TNPSC Study Material',
    description: 'Direct access to official TNPSC notifications and preparation resources.',
    href: 'https://tnpsc.gov.in/',
    badge: 'TNPSC',
  },
  {
    title: 'Official Mock Test Portal',
    description: 'Practice with official-style mock tests for UPSC and allied services.',
    href: 'https://www.prepp.in/',
    badge: 'Practice',
  },
];

export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-surface">
      <section className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-stack-lg">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-secondary">Student library</p>
            <h1 className="text-[32px] md:text-[40px] font-bold text-primary">Free preparation resources</h1>
            <p className="mt-2 max-w-2xl text-[16px] text-on-surface-variant">
              A clean resource hub for official syllabi, prior question papers, and trusted mock-test portals.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-secondary hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Back to dashboard
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {resources.map((resource) => (
            <article key={resource.title} className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full bg-secondary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-secondary">
                  {resource.badge}
                </span>
                <span className="material-symbols-outlined text-[24px] text-primary">menu_book</span>
              </div>
              <h2 className="text-[20px] font-semibold text-primary">{resource.title}</h2>
              <p className="mt-3 text-sm text-on-surface-variant">{resource.description}</p>
              <Link
                href={resource.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-secondary"
              >
                Open resource
                <span className="material-symbols-outlined">open_in_new</span>
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-outline-variant bg-primary-container p-8 text-on-primary-container shadow-sm">
          <h2 className="text-[24px] font-bold">Recommended study plan</h2>
          <p className="mt-3 max-w-3xl text-sm text-primary-fixed-dim">
            Use the official syllabus first, solve PYQs next, and finish with mock tests to build accuracy before the real exam window opens.
          </p>
        </div>
      </section>
    </main>
  );
}
