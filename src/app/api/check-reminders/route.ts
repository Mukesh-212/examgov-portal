import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    // 1. Verify Request Security Header
    const authHeader = req.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized security check failed' }, { status: 401 });
    }

    // 2. Calculate the target date exactly 3 days from now
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 3);
    const dateString = targetDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // 3. Look up exams closing on that day
    const { data: exams, error: examError } = await supabase
      .from('exams')
      .select('*')
      .eq('end_date', dateString);

    if (examError) {
      console.error('Check reminders query error:', examError);
      return NextResponse.json({ error: examError.message }, { status: 500 });
    }

    if (!exams || exams.length === 0) {
      return NextResponse.json({ success: true, message: "No urgent exams found closing in 3 days." }, { status: 200 });
    }

    // 4. Configure Free Gmail SMTP Transport Engine
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error('Reminder email configuration is incomplete: EMAIL_USER and EMAIL_PASS must be set.');
      return NextResponse.json({ error: 'Email configuration is incomplete' }, { status: 500 });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    let emailsDispatchedCount = 0;

    // 5. Loop through found exams and email matching students
    for (const exam of exams) {
      const { data: subscribers, error: subError } = await supabase
        .from('subscribers')
        .select('email')
        .contains('subscribed_categories', [exam.category]);

      if (subError) {
        console.error(`Error querying subscribers for category ${exam.category}:`, subError);
        continue;
      }

      if (subscribers && subscribers.length > 0) {
        const emailList = subscribers
          .map((sub) => sub.email)
          .filter((email): email is string => Boolean(email));

        if (emailList.length > 0) {
          try {
            await transporter.sendMail({
              from: `"Exam Alert System" <${emailUser}>`,
              to: emailList.join(','),
              subject: `⚠️ Urgent Reminder: ${exam.title} Closes in 3 Days!`,
              html: `
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
                  <p style="font-size: 11px; color: #777; border-top: 1px solid #eee; padding-top: 15px; margin-top: 25px;"> You received this message because your profile is registered to track ${exam.category} deadline updates.</p>
                </div>
              `
            });
            emailsDispatchedCount += emailList.length;
          } catch (mailError) {
            console.error('Reminder email dispatch failed:', mailError);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Processing complete',
      target_date: dateString,
      exams_processed: exams.length,
      emails_sent: emailsDispatchedCount
    }, { status: 200 });

  } catch (err: unknown) {
    console.error('API Server Error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal Server Error', details: message }, { status: 500 });
  }
}
