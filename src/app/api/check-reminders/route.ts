import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface Exam {
  id: string;
  title: string;
  category: string;
  open_date: string | null;
  end_date: string;
  source_url: string | null;
}

interface Subscriber {
  email: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) {
    return transporter;
  }

  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set as environment variables');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: emailUser, pass: emailPass },
  });

  return transporter;
}

function getUTCDateInDays(days: number): string {
  const now = new Date();
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)
  );
  return target.toISOString().split('T')[0];
}

function buildReminderEmailHtml(exam: Exam): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #d32f2f; margin-top: 0;">Registration Deadline Approaching!</h2>
      <p>Hello Applicant,</p>
      <p>This is an automated system alert that the official application registration window for <strong>${exam.title}</strong> is closing soon.</p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr><td style="padding: 6px 0;"><strong>Exam Category:</strong></td><td>${exam.category}</td></tr>
        <tr><td style="padding: 6px 0;"><strong>Closing Deadline Date:</strong></td><td style="color: #d32f2f;"><strong>${exam.end_date}</strong></td></tr>
      </table>
      <div style="margin: 25px 0;">
        <a href="${exam.source_url || '#'}" style="background-color: #1d3557; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">Complete Application Form Here</a>
      </div>
      <p style="font-size: 11px; color: #777; border-top: 1px solid #eee; padding-top: 15px; margin-top: 25px;">You received this message because your profile is registered to track ${exam.category} deadline updates.</p>
    </div>
  `;
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();

  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[REMINDERS] CRON_SECRET environment variable is not set');
      return NextResponse.json(
        { error: 'Server configuration error: CRON_SECRET not set' },
        { status: 500 }
      );
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[REMINDERS] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dateString = getUTCDateInDays(3);
    console.log(`[REMINDERS] Target date: ${dateString}`);

    const { data: exams, error: examError } = await supabaseAdmin
      .from('exams')
      .select('id, title, category, open_date, end_date, source_url')
      .eq('end_date', dateString);

    if (examError) {
      console.error(`[REMINDERS] Exam query error: ${examError.message}`);
      return NextResponse.json(
        { error: 'Database query failed', details: examError.message },
        { status: 500 }
      );
    }

    console.log(`[REMINDERS] Found ${exams?.length ?? 0} exam(s) closing on ${dateString}`);

    if (!exams || exams.length === 0) {
      return NextResponse.json({
        success: true,
        message: `No exams found closing on ${dateString}.`,
        target_date: dateString,
        exams_processed: 0,
        emails_sent: 0,
        duration_ms: Date.now() - startTime,
        hint: 'Verify exams exist in the database and that SUPABASE_SERVICE_ROLE_KEY has SELECT access.',
      });
    }

    let transport: nodemailer.Transporter;
    try {
      transport = getTransporter();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[REMINDERS] Email config error: ${message}`);
      return NextResponse.json({ error: 'Email configuration error' }, { status: 500 });
    }

    const sendPromises: Promise<void>[] = [];

    for (const exam of exams) {
      const { data: subscribers, error: subError } = await supabaseAdmin
        .from('subscribers')
        .select('email')
        .contains('subscribed_categories', [exam.category]);

      if (subError) {
        console.error(`[REMINDERS] Subscriber query error for ${exam.category}: ${subError.message}`);
        continue;
      }

      if (!subscribers || subscribers.length === 0) {
        console.log(`[REMINDERS] No subscribers for category "${exam.category}"`);
        continue;
      }

      const validSubscribers = subscribers.filter(
        (sub): sub is Subscriber => typeof sub.email === 'string' && sub.email.length > 0
      );

      console.log(`[REMINDERS] ${validSubscribers.length} subscriber(s) for "${exam.title}"`);

      const { data: alreadySent, error: sentError } = await supabaseAdmin
        .from('sent_reminders')
        .select('subscriber_email')
        .eq('exam_id', exam.id);

      if (sentError) {
        console.error(`[REMINDERS] sent_reminders query error for exam ${exam.id}: ${sentError.message}`);
        continue;
      }

      const alreadySentSet = new Set(alreadySent?.map((r) => r.subscriber_email) ?? []);
      const unsent = validSubscribers.filter((sub) => !alreadySentSet.has(sub.email));

      if (unsent.length === 0) {
        console.log(`[REMINDERS] All subscribers already notified for "${exam.title}"`);
        continue;
      }

      console.log(`[REMINDERS] Sending ${unsent.length} new reminder(s) for "${exam.title}"`);

      for (const subscriber of unsent) {
        const sendPromise = (async () => {
          try {
            const { error: insertError } = await supabaseAdmin
              .from('sent_reminders')
              .insert({ exam_id: exam.id, subscriber_email: subscriber.email });

            if (insertError) {
              if (insertError.code === '23505') {
                console.log(`[REMINDERS] Already recorded: ${subscriber.email} for "${exam.title}"`);
              } else {
                console.error(`[REMINDERS] sent_reminders insert error for ${subscriber.email}: ${insertError.message}`);
              }
              return;
            }

            await transport.sendMail({
              from: `"Exam Alert System" <${process.env.EMAIL_USER}>`,
              to: subscriber.email,
              subject: `⚠️ Urgent Reminder: ${exam.title} Closes in 3 Days!`,
              html: buildReminderEmailHtml(exam),
            });

            console.log(`[REMINDERS] Sent: ${subscriber.email} for "${exam.title}"`);
          } catch (mailError) {
            const message = mailError instanceof Error ? mailError.message : 'Unknown error';
            console.error(`[REMINDERS] Failed to send to ${subscriber.email}: ${message}`);

            const { error: deleteError } = await supabaseAdmin
              .from('sent_reminders')
              .delete()
              .eq('exam_id', exam.id)
              .eq('subscriber_email', subscriber.email);

            if (deleteError) {
              console.error(`[REMINDERS] Failed to clean up sent_reminders for ${subscriber.email}: ${deleteError.message}`);
            }
          }
        })();

        sendPromises.push(sendPromise);
      }
    }

    await Promise.allSettled(sendPromises);

    const duration = Date.now() - startTime;
    console.log(`[REMINDERS] Complete. ${sendPromises.length} attempt(s) in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'Processing complete',
      target_date: dateString,
      exams_processed: exams.length,
      emails_attempted: sendPromises.length,
      duration_ms: duration,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[REMINDERS] Fatal error: ${message}`);
    return NextResponse.json(
      { error: 'Internal Server Error', details: message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
