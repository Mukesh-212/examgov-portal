import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

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

    const { data, error } = await supabaseAdmin
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
  } catch (err: unknown) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Exam ID is required.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('exams')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete exam error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Exam deleted successfully.' });
  } catch (err: unknown) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
