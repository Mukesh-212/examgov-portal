import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, category, open_date, end_date, source_url } = body;

    if (!title || !category || !open_date || !end_date) {
      return NextResponse.json(
        { error: 'Title, category, open_date, and end_date are required.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('exams')
      .insert({
        title,
        category,
        open_date,
        end_date,
        source_url
      })
      .select();

    if (error) {
      console.error('Insert exam error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
