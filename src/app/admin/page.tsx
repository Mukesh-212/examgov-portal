'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface Exam {
  id: string;
  title: string;
  category: string;
  open_date: string;
  end_date: string;
  source_url: string;
  status?: string;
}

export default function AdminDashboard() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [subscriberCount, setSubscriberCount] = useState<number>(12450); // Fallback to design mock count
  const [loading, setLoading] = useState<boolean>(true);

  // Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Load database entries
  const fetchAdminData = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      // Fetch exams (only upcoming)
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: examsData, error: examsError } = await supabase
        .from('exams')
        .select('*')
        .gte('end_date', todayStr)
        .order('end_date', { ascending: true });

      if (examsError) {
        console.warn('Could not fetch exams for admin list:', examsError.message);
      } else if (examsData) {
        setExams(examsData);
      }

      // Fetch subscribers count
      const { count, error: countError } = await supabase
        .from('subscribers')
        .select('*', { count: 'exact', head: true });

      if (countError) {
        console.warn('Could not fetch subscribers count:', countError.message);
      } else if (count !== null) {
        setSubscriberCount(count);
      }
    } catch (err) {
      console.warn('Database error:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const { data: examsData, error: examsError } = await supabase
          .from('exams')
          .select('*')
          .gte('end_date', todayStr)
          .order('end_date', { ascending: true });

        if (examsError) {
          console.warn('Could not fetch exams for admin list:', examsError.message);
        } else if (examsData) {
          setExams(examsData);
        }

        const { count, error: countError } = await supabase
          .from('subscribers')
          .select('*', { count: 'exact', head: true });

        if (countError) {
          console.warn('Could not fetch subscribers count:', countError.message);
        } else if (count !== null) {
          setSubscriberCount(count);
        }
      } catch (err) {
        console.warn('Database error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !category || !endDate) {
      setFormMessage({ text: 'Please fill out all required fields.', type: 'error' });
      return;
    }

    setFormSubmitting(true);
    setFormMessage(null);

    const payload = {
      title,
      category,
      open_date: new Date().toISOString().split('T')[0], // Defaults to today for the database open_date
      end_date: endDate,
      source_url: sourceUrl || null,
    };

    try {
      const res = await fetch('/api/admin/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (res.ok) {
        setFormMessage({ text: 'Exam entry saved successfully to Supabase!', type: 'success' });
        // Reset form
        setTitle('');
        setCategory('');
        setEndDate('');
        setSourceUrl('');
        // Reload list
        fetchAdminData(true);
      } else {
        setFormMessage({ text: result.error || 'Failed to save exam.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setFormMessage({ text: 'Failed to connect to the server.', type: 'error' });
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Delete Entry
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this exam entry from the database?')) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/exams?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      const result = await res.json();

      if (res.ok) {
        fetchAdminData();
      } else {
        alert('Delete failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Connection failed while attempting to delete.');
    }
  };

  // Date formatting helper
  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.toUpperCase() === 'TBA') return 'TBA';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Determine status label based on deadline date
  const getStatusBadge = (endDateStr: string) => {
    if (!endDateStr || endDateStr.toUpperCase() === 'TBA') {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#fef08a] text-[#854d0e]">
          Pending Review
        </span>
      );
    }
    const deadline = new Date(endDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (deadline < today) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#f1f5f9] text-[#475569]">
          Closed
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#dcfce7] text-[#166534]">
          Active
        </span>
      );
    }
  };

  return (
    <>
      {/* TopNavBar */}
      <nav className="bg-surface border-b border-outline-variant w-full px-margin-desktop max-w-container-max mx-auto h-16 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-[24px] font-bold text-primary flex items-center gap-2">
            <span className="material-symbols-outlined filled text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              account_balance
            </span>
            ExamGov Portal
          </Link>
          <div className="hidden md:flex gap-6 h-full items-end">
            <Link href="/" className="text-on-surface-variant hover:text-secondary transition-colors text-[14px] font-semibold pb-4 focus:ring-2 focus:ring-secondary focus:ring-offset-2">
              Exams
            </Link>
            <a href="#" className="text-on-surface-variant hover:text-secondary transition-colors text-[14px] font-semibold pb-4 focus:ring-2 focus:ring-secondary focus:ring-offset-2">
              Notifications
            </a>
            <a href="#" className="text-on-surface-variant hover:text-secondary transition-colors text-[14px] font-semibold pb-4 focus:ring-2 focus:ring-secondary focus:ring-offset-2">
              Resources
            </a>
            <a href="#" className="text-on-surface-variant hover:text-secondary transition-colors text-[14px] font-semibold pb-4 focus:ring-2 focus:ring-secondary focus:ring-offset-2">
              Reminders
            </a>
            <Link href="/admin" className="text-secondary border-b-2 border-secondary pb-3 text-[14px] font-semibold focus:ring-2 focus:ring-secondary focus:ring-offset-2">
              Admin Access
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block">
            <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-outline">search</span>
            <input
              className="pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-full text-[16px] focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent w-64 transition-all"
              placeholder="Search..."
              type="text"
            />
          </div>
          <button className="bg-primary text-on-primary px-6 py-2 rounded text-[14px] font-semibold hover:bg-on-primary-fixed-variant transition-colors focus:ring-2 focus:ring-secondary">
            Admin Access
          </button>
        </div>
      </nav>

      {/* Main Content Grid */}
      <main className="max-w-container-max mx-auto px-margin-desktop py-8 grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        {/* Header Section */}
        <header className="lg:col-span-12 mb-stack-lg">
          <h1 className="text-[32px] font-bold text-primary mb-2">Admin Dashboard</h1>
          <p className="text-on-surface-variant">Manage exams, monitor system metrics, and maintain database integrity.</p>
        </header>

        {/* Left Column: Form */}
        <section className="lg:col-span-4 flex flex-col gap-stack-lg">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-secondary"></div>
            <h2 className="text-[24px] font-bold text-primary mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">add_circle</span>
              Add New Exam
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-semibold text-on-surface-variant" htmlFor="exam-name">
                  Exam Name
                </label>
                <input
                  className="border border-outline-variant rounded p-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent bg-surface-container-lowest"
                  id="exam-name"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Civil Services Mains 2025"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-semibold text-on-surface-variant" htmlFor="category">
                  Category
                </label>
                <div className="relative">
                  <select
                    className="appearance-none w-full border border-outline-variant rounded p-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent bg-surface-container-lowest pr-10"
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select a category</option>
                    <option value="UPSC">UPSC (Union Public Service)</option>
                    <option value="SSC">SSC (Staff Selection)</option>
                    <option value="Banking">Banking (IBPS/SBI)</option>
                    <option value="Railways">Railways (RRB)</option>
                    <option value="TNPSC">TNPSC (Tamil Nadu PSC)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none text-outline">
                    arrow_drop_down
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-semibold text-on-surface-variant" htmlFor="closing-date">
                  Closing Date
                </label>
                <input
                  className="w-full border border-outline-variant rounded p-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent bg-surface-container-lowest pr-10"
                  id="closing-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-semibold text-on-surface-variant" htmlFor="official-link">
                  Official Link (URL)
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-outline">link</span>
                  <input
                    className="pl-10 border border-outline-variant rounded p-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent bg-surface-container-lowest w-full"
                    id="official-link"
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={formSubmitting}
                className="mt-4 bg-primary text-on-primary py-3 rounded text-[14px] font-semibold hover:bg-on-primary-fixed-variant transition-colors flex justify-center items-center gap-2 focus:ring-2 focus:ring-secondary disabled:opacity-50"
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  save
                </span>
                {formSubmitting ? 'Saving entry...' : 'Save Exam Entry'}
              </button>
            </form>

            {formMessage && (
              <div className={`mt-4 p-4 rounded-lg flex items-center gap-2 border ${formMessage.type === 'success'
                  ? 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]'
                  : 'bg-error-container text-on-error-container border-outline'
                }`}>
                <span className="material-symbols-outlined">
                  {formMessage.type === 'success' ? 'check_circle' : 'error'}
                </span>
                <span className="text-[14px] font-semibold">{formMessage.text}</span>
              </div>
            )}
          </div>

          {/* Warning Banner Example */}
          <div className="bg-error-container text-on-error-container p-4 rounded-xl flex items-start gap-3 border-l-4 border-error">
            <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>
              warning
            </span>
            <div>
              <h4 className="text-[14px] font-bold mb-1">System Maintenance Notice</h4>
              <p className="text-[12px]">Database synchronization scheduled for 02:00 AM UTC. Please ensure all manual entries are saved before this window.</p>
            </div>
          </div>
        </section>

        {/* Right Column: Metrics & Table */}
        <section className="lg:col-span-8 flex flex-col gap-stack-lg">
          {/* Metrics Panel (Bento-style Grid) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
            <div className="bg-primary text-on-primary rounded-xl p-6 relative overflow-hidden flex flex-col justify-between shadow-sm h-40 group hover:shadow-md transition-shadow">
              <div className="absolute -right-8 -bottom-8 opacity-10 transform group-hover:scale-110 transition-transform duration-500">
                <span className="material-symbols-outlined text-[120px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  group
                </span>
              </div>
              <div>
                <p className="text-[14px] font-semibold text-primary-fixed-dim uppercase tracking-widest mb-1">Total Subscribed Users</p>
                <h3 className="text-[48px] font-bold">{subscriberCount.toLocaleString()}</h3>
              </div>
              <div className="flex items-center gap-1 text-secondary-fixed text-[12px] font-semibold">
                <span className="material-symbols-outlined text-[16px]">trending_up</span>
                <span>Dynamic from Supabase</span>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 relative overflow-hidden flex flex-col justify-between shadow-sm h-40">
              <div className="absolute top-0 right-0 w-2 h-full bg-secondary-container"></div>
              <div>
                <p className="text-[14px] font-semibold text-on-surface-variant uppercase tracking-widest mb-1">Active System Monitors</p>
                <div className="flex items-baseline gap-3">
                  <h3 className="text-[48px] font-bold text-primary">8</h3>
                  <span className="text-[14px] font-semibold text-secondary">Online</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  <div className="w-6 h-6 rounded-full bg-surface-variant border-2 border-white flex items-center justify-center text-[10px] font-bold text-on-surface-variant">AJ</div>
                  <div className="w-6 h-6 rounded-full bg-secondary-container border-2 border-white flex items-center justify-center text-[10px] font-bold text-on-secondary-container">KL</div>
                  <div className="w-6 h-6 rounded-full bg-tertiary-container border-2 border-white flex items-center justify-center text-[10px] font-bold text-on-tertiary-container">MR</div>
                  <div className="w-6 h-6 rounded-full bg-surface-dim border-2 border-white flex items-center justify-center text-[10px] font-bold text-on-surface-variant">+5</div>
                </div>
              </div>
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex-grow flex flex-col">
            <div className="p-6 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
              <h2 className="text-[24px] font-bold text-primary">Current Database Entries</h2>
              <div className="flex gap-2">
                <button onClick={() => fetchAdminData()} className="p-2 text-on-surface-variant hover:text-primary transition-colors focus:ring-2 focus:ring-secondary rounded" title="Refresh">
                  <span className="material-symbols-outlined">refresh</span>
                </button>
                <button className="p-2 text-on-surface-variant hover:text-primary transition-colors focus:ring-2 focus:ring-secondary rounded" title="Export">
                  <span className="material-symbols-outlined">download</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto flex-grow">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container text-primary text-[14px] font-bold border-b border-outline-variant">
                    <th className="py-3 px-6 font-semibold">ID</th>
                    <th className="py-3 px-6 font-semibold">Exam Name</th>
                    <th className="py-3 px-6 font-semibold">Category</th>
                    <th className="py-3 px-6 font-semibold">Status</th>
                    <th className="py-3 px-6 font-semibold text-right">Closing Date</th>
                    <th className="py-3 px-6 font-semibold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-[16px] text-on-surface">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-6 text-center text-on-surface-variant">
                        Loading database entries...
                      </td>
                    </tr>
                  ) : exams.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-6 text-center text-on-surface-variant">
                        No database entries found. Add a new exam to get started.
                      </td>
                    </tr>
                  ) : (
                    exams.map((exam) => (
                      <tr key={exam.id} className="border-b border-outline-variant hover:bg-surface-container-low transition-colors">
                        <td className="py-4 px-6 text-on-surface-variant font-mono text-xs max-w-[80px] truncate" title={exam.id}>
                          #{exam.id.substring(0, 8)}
                        </td>
                        <td className="py-4 px-6 font-semibold text-primary">{exam.title}</td>
                        <td className="py-4 px-6">{exam.category}</td>
                        <td className="py-4 px-6">
                          {getStatusBadge(exam.end_date)}
                        </td>
                        <td className="py-4 px-6 text-right">{formatDate(exam.end_date)}</td>
                        <td className="py-4 px-6 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => handleDelete(exam.id)}
                              className="text-error hover:text-[#93000a] transition-colors p-1 focus:ring-2 focus:ring-error rounded"
                              title="Delete"
                            >
                              <span className="material-symbols-outlined text-[20px]">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-outline-variant bg-surface-container-lowest flex justify-between items-center text-[12px] text-on-surface-variant">
              <span>Showing {exams.length} entries</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-tertiary text-on-tertiary text-[12px] w-full py-8 border-t border-on-tertiary-fixed-variant flex flex-col md:flex-row justify-between items-center px-margin-desktop max-w-container-max mx-auto gap-4 mt-auto">
        <div className="text-[14px] font-semibold uppercase tracking-widest text-on-tertiary">
          ExamGov Portal
        </div>
        <div>
          © 2024 National Examinations Authority. An official government portal.
        </div>
        <div className="flex gap-4">
          <a className="text-tertiary-fixed-dim hover:text-on-tertiary transition-colors focus:outline-white focus:outline-2 focus:outline-offset-2 rounded px-1" href="#">Accessibility Statement</a>
          <a className="text-tertiary-fixed-dim hover:text-on-tertiary transition-colors focus:outline-white focus:outline-2 focus:outline-offset-2 rounded px-1" href="#">Privacy Policy</a>
          <a className="text-tertiary-fixed-dim hover:text-on-tertiary transition-colors focus:outline-white focus:outline-2 focus:outline-offset-2 rounded px-1" href="#">Terms of Service</a>
          <a className="text-tertiary-fixed-dim hover:text-on-tertiary transition-colors focus:outline-white focus:outline-2 focus:outline-offset-2 rounded px-1" href="#">Contact Us</a>
        </div>
      </footer>
    </>
  );
}
