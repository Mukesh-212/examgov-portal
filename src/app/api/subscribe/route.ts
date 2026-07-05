import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function normalizeCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) {
    return [];
  }

  return categories.filter(
    (category): category is string => typeof category === 'string' && category.trim().length > 0
  );
}

export async function GET(req: NextRequest) {
  try {
    const email = req.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('subscribers')
      .select('email, subscribed_categories')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.error('Fetch subscriber error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, found: Boolean(data), data });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, categories } = body;

    if (!email || !Array.isArray(categories)) {
      return NextResponse.json(
        { error: 'Email and categories array are required.' },
        { status: 400 }
      );
    }

    const normalizedCategories = normalizeCategories(categories);

    if (normalizedCategories.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one category.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('subscribers')
      .upsert(
        { email, subscribed_categories: normalizedCategories },
        { onConflict: 'email' }
      )
      .select();

    if (error) {
      console.error('Subscription error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, categories } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const normalizedCategories = normalizeCategories(categories);

    if (normalizedCategories.length === 0) {
      return NextResponse.json({ error: 'Select at least one category.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('subscribers')
      .update({ subscribed_categories: normalizedCategories })
      .eq('email', email)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Update preferences error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Subscriber not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = body?.email || req.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const { error } = await supabase.from('subscribers').delete().eq('email', email);

    if (error) {
      console.error('Unsubscribe error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Unsubscribed successfully.' });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
