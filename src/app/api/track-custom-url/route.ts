import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = 'meta-llama/llama-3-8b-instruct';

const SYSTEM_PROMPT = `Extract the primary Exam Name, Application Start Date, and Application Deadline from the following HTML.
Return strictly a valid JSON object with no markdown wrappers, no backticks, and no extra text in this exact format:
{"title": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}
Only return the raw JSON object and nothing else.`;

export async function POST(req: Request) {
  try {
    // 1. Parse and validate request body
    const body = await req.json();
    const url: string = body?.url?.toString()?.trim();
    const category: string = body?.category?.toString()?.trim();

    if (!url || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: url and category' },
        { status: 400 }
      );
    }

    // 2. Fetch the raw HTML from the target URL
    const pageResponse = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!pageResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: HTTP ${pageResponse.status}` },
        { status: 400 }
      );
    }

    const rawHtml = await pageResponse.text();
    // Limit to 40 000 chars to stay within model context
    const htmlSnippet = rawHtml.slice(0, 40000);

    // 3. Forward to OpenRouter (google/gemini-2.5-flash)
    const aiResponse = await fetch(OPENROUTER_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://examgov.vercel.app',
        'X-Title': 'ExamGov Portal',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'user',
            content: `${SYSTEM_PROMPT}\n\nHTML:\n${htmlSnippet}`,
          },
        ],
        temperature: 0,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      return NextResponse.json(
        { error: 'OpenRouter API error', details: errorText },
        { status: 502 }
      );
    }

    const aiJson = await aiResponse.json();
    let rawContent: string = aiJson?.choices?.[0]?.message?.content ?? '';

    // Strip any markdown fences the model may still include
    rawContent = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    // 4. Parse the strict JSON from the model's reply
    let extracted: { title: string; start_date: string; end_date: string };
    try {
      extracted = JSON.parse(rawContent);
    } catch (parseError) {
      return NextResponse.json(
        {
          error: 'Failed to parse AI response as JSON',
          details: String(parseError),
          aiResponse: rawContent,
        },
        { status: 500 }
      );
    }

    // 5. Upsert into 'exams' table (conflict on source_url)
    const examPayload = {
      title: extracted.title,
      category,
      open_date: extracted.start_date,
      end_date: extracted.end_date,
      source_url: url,
    };

    const { error: examError } = await supabase
      .from('exams')
      .upsert(examPayload, { onConflict: 'source_url' });

    if (examError) {
      console.error('Supabase exams upsert error:', examError.message);
      return NextResponse.json(
        { error: 'Failed to upsert exam record', details: examError.message },
        { status: 500 }
      );
    }

    // 6. Register source in 'tracked_sources' table (conflict on url)
    const { error: sourceError } = await supabase
      .from('tracked_sources')
      .upsert({ url, category }, { onConflict: 'url' });

    if (sourceError) {
      console.error('Supabase tracked_sources upsert error:', sourceError.message);
      return NextResponse.json(
        { error: 'Failed to upsert tracked source', details: sourceError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: examPayload }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Unexpected server error', details: message },
      { status: 500 }
    );
  }
}
