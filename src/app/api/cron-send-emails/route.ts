import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client using non-null assertions for strict typing
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  try {
    // 1. Security gate — verify Authorization header matches CRON_SECRET
    const authHeader = req.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET!}`) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing CRON_SECRET.' },
        { status: 401 }
      );
    }

    // 2. Compute the exact target date 3 days from the current runtime
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 3);
    const dateString = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

    // 3. Query Supabase for exams closing exactly on that target date
    const { data: exams, error: examError } = await supabase
      .from('exams')
      .select('*')
      .eq('end_date', dateString);

    if (examError) {
      console.error('Cron exams query error:', examError);
      return NextResponse.json({ error: examError.message }, { status: 500 });
    }

    if (!exams || exams.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: `No exams found closing on ${dateString}. No emails dispatched.`,
          target_date: dateString,
        },
        { status: 200 }
      );
    }

    // 4. Build Gmail SMTP transporter using nodemailer
    const emailUser = process.env.EMAIL_USER!;
    const emailPass = process.env.EMAIL_PASS!;

    if (!emailUser || !emailPass) {
      console.error('Email configuration incomplete: EMAIL_USER and EMAIL_PASS must be set.');
      return NextResponse.json(
        { error: 'Email configuration is incomplete on the server.' },
        { status: 500 }
      );
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    let emailsDispatchedCount = 0;

    // 5. Loop through each matched exam and dispatch alerts to subscribed users
    for (const exam of exams) {
      // Fetch all subscribers tracking this exam's category
      const { data: subscribers, error: subError } = await supabase
        .from('subscribers')
        .select('email')
        .contains('subscribed_categories', [exam.category]);

      if (subError) {
        console.error(
          `Error querying subscribers for category "${exam.category}":`,
          subError
        );
        continue;
      }

      if (!subscribers || subscribers.length === 0) {
        continue;
      }

      const emailList: string[] = subscribers
        .map((sub: { email: string | null }) => sub.email)
        .filter((email): email is string => Boolean(email));

      if (emailList.length === 0) {
        continue;
      }

      try {
        await transporter.sendMail({
          from: `"ExamGov Alert System" <${emailUser}>`,
          to: emailList.join(','),
          subject: `⚠️ Deadline Alert: ${exam.title} closes in 3 days!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 10px; background: #ffffff;">
              <div style="background: #003366; padding: 20px 24px; border-radius: 8px 8px 0 0; margin: -24px -24px 24px -24px;">
                <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700;">⚡ ExamGov Portal</h1>
                <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0 0; font-size: 13px;">Registration Deadline Reminder</p>
              </div>

              <h2 style="color: #d32f2f; margin-top: 0; font-size: 18px;">🚨 Registration Closing in 3 Days!</h2>

              <p style="color: #374151; font-size: 15px;">Hello Applicant,</p>
              <p style="color: #374151; font-size: 15px;">
                This is an automated alert from ExamGov Portal. The official application registration window for
                <strong style="color: #003366;">${exam.title}</strong> is closing in just <strong>3 days</strong>.
              </p>

              <table style="width: 100%; margin: 20px 0; border-collapse: collapse; background: #f8fafc; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td style="padding: 12px 16px; font-size: 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb; width: 40%;"><strong>Exam Name</strong></td>
                  <td style="padding: 12px 16px; font-size: 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${exam.title}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; font-size: 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;"><strong>Category</strong></td>
                  <td style="padding: 12px 16px; font-size: 14px; color: #111827; border-bottom: 1px solid #e5e7eb;">${exam.category}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; font-size: 14px; color: #6b7280;"><strong>Application Deadline</strong></td>
                  <td style="padding: 12px 16px; font-size: 14px; font-weight: 700; color: #d32f2f;">${exam.end_date}</td>
                </tr>
              </table>

              <div style="margin: 28px 0;">
                <a
                  href="${exam.source_url || '#'}"
                  style="background-color: #003366; color: #ffffff; padding: 13px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 700; font-size: 15px;"
                >
                  → Complete Application Now
                </a>
              </div>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">
                You received this alert because your email is registered on ExamGov Portal to track
                <strong>${exam.category}</strong> deadline notifications.
                This is a free, automated public service.
              </p>
            </div>
          `,
        });

        emailsDispatchedCount += emailList.length;
        console.log(
          `[CRON] Dispatched ${emailList.length} alert(s) for "${exam.title}" (deadline: ${exam.end_date}).`
        );
      } catch (mailError) {
        console.error(`[CRON] Email dispatch failed for "${exam.title}":`, mailError);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Cron email dispatch complete.',
        target_date: dateString,
        exams_processed: exams.length,
        emails_sent: emailsDispatchedCount,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('[CRON] Fatal error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal Server Error', details: message },
      { status: 500 }
    );
  }
}
