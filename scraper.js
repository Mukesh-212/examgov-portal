/**
 * ExamGov Portal — Nightly Web Scraper
 * Powered by Playwright (Chromium) + OpenRouter API (google/gemini-2.5-flash)
 *
 * Execution: node scraper.js
 * Triggered by: .github/workflows/scrape.yml (nightly at 1:00 AM UTC)
 */

require('dotenv').config({ path: '.env.local' });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// ──────────────────────────────────────────────────────────────────────────────
// Environment validation
// ──────────────────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

if (
  !supabaseUrl ||
  !supabaseAnonKey ||
  supabaseUrl.includes('your-project-id') ||
  supabaseAnonKey.includes('your-anon-key')
) {
  console.error('[ERROR] Supabase credentials are missing or invalid.');
  console.error('        Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.');
  process.exit(1);
}

if (!openRouterApiKey || openRouterApiKey.includes('your_openrouter')) {
  console.error('[ERROR] OPENROUTER_API_KEY is missing or invalid. Set it in .env.local.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = 'google/gemini-2.5-flash';

const EXTRACTION_PROMPT = `Extract the primary Exam Name, Application Start Date, and Application Deadline from the following HTML.
Return strictly a valid JSON object with no markdown wrappers, no backticks, and no extra text in this exact format:
{"title": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}
Only return the raw JSON object and nothing else.`;

// ──────────────────────────────────────────────────────────────────────────────
// OpenRouter AI extraction helper
// ──────────────────────────────────────────────────────────────────────────────
async function parseHtmlWithOpenRouter(html) {
  const truncatedHtml = html.slice(0, 40000);

  const response = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://examgov.vercel.app',
      'X-Title': 'ExamGov Nightly Scraper',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\nHTML:\n${truncatedHtml}`,
        },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  let rawContent = json?.choices?.[0]?.message?.content ?? '';

  // Strip any residual markdown fences
  rawContent = rawContent
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  try {
    return JSON.parse(rawContent);
  } catch (parseError) {
    throw new Error(`Failed to parse OpenRouter response as JSON. Raw: ${rawContent}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Indian date format normaliser (DD/MM/YYYY, DD-MM-YYYY, DD Month YYYY)
// ──────────────────────────────────────────────────────────────────────────────
function parseIndianDate(dateText) {
  if (!dateText) return null;

  const cleanText = dateText
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Format 1: DD/MM/YYYY or DD-MM-YYYY
  const slashDashRegex = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/;
  let match = cleanText.match(slashDashRegex);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  // Format 2: DD Month YYYY (e.g. "05 Mar 2025", "5 March 2025")
  const monthMap = {
    jan: '01', january: '01', feb: '02', february: '02',
    mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const textMonthRegex = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;
  match = cleanText.match(textMonthRegex);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthName = match[2].toLowerCase().substring(0, 3);
    const month = monthMap[monthName];
    const year = match[3];
    if (month) return `${year}-${month}-${day}`;
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Fallback injector — inserts known static notices when live scrape fails
// ──────────────────────────────────────────────────────────────────────────────
async function injectFallbackExams(examRecords) {
  if (!Array.isArray(examRecords) || examRecords.length === 0) return 0;

  console.log(`[FALLBACK] Injecting ${examRecords.length} fallback record(s)...`);
  let injectedCount = 0;

  for (const exam of examRecords) {
    try {
      const { data: existing, error: existsError } = await supabase
        .from('exams')
        .select('id')
        .eq('title', exam.title)
        .limit(1);

      if (existsError) {
        console.error('[FALLBACK] Existence check error:', existsError.message);
        continue;
      }

      if (existing && existing.length > 0) continue; // Already in DB

      const { error: insertError } = await supabase.from('exams').insert(exam);
      if (insertError) {
        console.error('[FALLBACK] Insert error:', insertError.message);
      } else {
        injectedCount++;
        console.log(`[FALLBACK INSERT] "${exam.title}"`);
      }
    } catch (err) {
      console.error('[FALLBACK] Exception:', err);
    }
  }

  return injectedCount;
}

// ──────────────────────────────────────────────────────────────────────────────
// TRACKED SOURCES — dynamic loop through user-submitted URLs via OpenRouter AI
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeCustomSources(page) {
  console.log('\n─── Scraping user-tracked custom portals ───');

  const { data: sources, error } = await supabase
    .from('tracked_sources')
    .select('url, category');

  if (error) {
    console.error('[CUSTOM] Failed to load tracked sources:', error.message);
    return [];
  }

  if (!sources || sources.length === 0) {
    console.log('[CUSTOM] No tracked custom portals found in database.');
    return [];
  }

  console.log(`[CUSTOM] Found ${sources.length} tracked source(s) to process.`);
  const customResults = [];

  for (const source of sources) {
    if (!source.url) continue;

    try {
      console.log(`[CUSTOM] Navigating to: ${source.url}`);
      await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const html = await page.content();
      const extracted = await parseHtmlWithOpenRouter(html);

      if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) {
        console.warn(`[CUSTOM] Incomplete AI extraction for ${source.url}. Skipping.`);
        continue;
      }

      const examPayload = {
        title: extracted.title,
        category: source.category || 'Custom',
        open_date: extracted.start_date,
        end_date: extracted.end_date,
        source_url: source.url,
      };

      // Upsert: update if exists, insert if new (keyed on source_url)
      const { error: upsertError } = await supabase
        .from('exams')
        .upsert(examPayload, { onConflict: 'source_url' });

      if (upsertError) {
        console.error(`[CUSTOM] Upsert failed for ${source.url}:`, upsertError.message);
      } else {
        console.log(`[CUSTOM] ✓ Upserted: "${extracted.title}" from ${source.url}`);
        customResults.push(examPayload);
      }
    } catch (err) {
      console.error(`[CUSTOM] Error processing ${source.url}:`, err.message || err);
    }
  }

  return customResults;
}

// ──────────────────────────────────────────────────────────────────────────────
// UPSC scraper
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeUPSC(page) {
  console.log('\n─── Scraping UPSC (Union Public Service Commission) ───');
  const results = [];

  try {
    await page.goto('https://upsc.gov.in/examinations/active-examinations', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const tableRows = await page.$$('table tbody tr');
    if (tableRows.length === 0) {
      throw new Error('No table rows found on UPSC page.');
    }

    for (const row of tableRows) {
      const cells = await row.$$('td');
      if (cells.length >= 3) {
        const titleText = await cells[0].innerText();
        const dateText = await cells[2].innerText();
        const title = titleText.replace(/[\n\r]/g, ' ').trim();
        const formattedDate = parseIndianDate(dateText);

        if (title && formattedDate) {
          results.push({
            title,
            category: 'UPSC',
            open_date: new Date().toISOString().split('T')[0],
            end_date: formattedDate,
            source_url: 'https://upsc.gov.in/examinations/active-examinations',
          });
        }
      }
    }

    console.log(`[UPSC] Scraped ${results.length} live record(s).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[UPSC] Live scrape failed: ${message}. Using fallback data.`);

    const fallback = [
      {
        title: 'Civil Services (Preliminary) Examination 2025',
        category: 'UPSC',
        open_date: new Date().toISOString().split('T')[0],
        end_date: '2025-03-05',
        source_url: 'https://upsc.gov.in/examinations/active-examinations',
      },
    ];
    await injectFallbackExams(fallback);
    return fallback;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// SSC scraper
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeSSC(page) {
  console.log('\n─── Scraping SSC (Staff Selection Commission) ───');
  const results = [];

  try {
    await page.goto('https://ssc.gov.in', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const notices = await page.$$('.notice-board-item, .notice-item, a[href*="notice"]');
    if (notices.length === 0) {
      throw new Error('No notice board elements found on SSC page.');
    }

    for (let i = 0; i < Math.min(notices.length, 5); i++) {
      const text = await notices[i].innerText();
      if (!text) continue;

      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines[0] || 'SSC Notification';
      const formattedDate =
        parseIndianDate(text) ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      results.push({
        title,
        category: 'SSC',
        open_date: new Date().toISOString().split('T')[0],
        end_date: formattedDate,
        source_url: 'https://ssc.gov.in',
      });
    }

    console.log(`[SSC] Scraped ${results.length} live record(s).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SSC] Live scrape failed: ${message}. Using fallback data.`);

    const fallback = [
      {
        title: 'Combined Graduate Level Examination (CGL) 2025',
        category: 'SSC',
        open_date: new Date().toISOString().split('T')[0],
        end_date: '2025-05-03',
        source_url: 'https://ssc.gov.in',
      },
    ];
    await injectFallbackExams(fallback);
    return fallback;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// TNPSC scraper
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeTNPSC(page) {
  console.log('\n─── Scraping TNPSC (Tamil Nadu Public Service Commission) ───');
  const results = [];

  try {
    await page.goto('https://www.tnpsc.gov.in/english/notification.html', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const rows = await page.$$('table tr');
    if (rows.length === 0) {
      throw new Error('No table rows found on TNPSC page.');
    }

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length >= 5) {
        const titleText = await cells[1].innerText();
        const endDateText = await cells[4].innerText();
        const title = titleText.replace(/[\n\r]/g, ' ').trim();
        const formattedDate = parseIndianDate(endDateText);

        if (title && formattedDate) {
          results.push({
            title,
            category: 'SSC',
            open_date: new Date().toISOString().split('T')[0],
            end_date: formattedDate,
            source_url: 'https://www.tnpsc.gov.in/english/notification.html',
          });
        }
      }
    }

    console.log(`[TNPSC] Scraped ${results.length} live record(s).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[TNPSC] Live scrape failed: ${message}. Using fallback data.`);

    const fallback = [
      {
        title: 'TNPSC Group II Recruitment Services Notification 2025',
        category: 'SSC',
        open_date: new Date().toISOString().split('T')[0],
        end_date: '2025-06-20',
        source_url: 'https://www.tnpsc.gov.in/english/notification.html',
      },
    ];
    await injectFallbackExams(fallback);
    return fallback;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main execution routine
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log('  ExamGov Nightly Scraper — OpenRouter + Playwright');
  console.log(`  Run time: ${new Date().toISOString()}`);
  console.log('════════════════════════════════════════════════════════');

  console.log('\nLaunching Playwright Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let allScrapedExams = [];

  try {
    const upscExams = await scrapeUPSC(page);
    allScrapedExams = allScrapedExams.concat(upscExams);

    const sscExams = await scrapeSSC(page);
    allScrapedExams = allScrapedExams.concat(sscExams);

    const tnpscExams = await scrapeTNPSC(page);
    allScrapedExams = allScrapedExams.concat(tnpscExams);

    // Custom user-submitted portals — uses OpenRouter AI for extraction
    const customExams = await scrapeCustomSources(page);
    allScrapedExams = allScrapedExams.concat(customExams);
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }

  console.log(`\n[SYNC] Total scraped entries: ${allScrapedExams.length}. Syncing to Supabase...`);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const exam of allScrapedExams) {
    try {
      // Skip records already handled by upsert in scrapeCustomSources
      if (exam.source_url && allScrapedExams.some((e) => e === exam && e._upserted)) {
        continue;
      }

      const { data: existing, error: fetchError } = await supabase
        .from('exams')
        .select('id')
        .eq('title', exam.title)
        .limit(1);

      if (fetchError) {
        console.error(`[SYNC] DB query error for "${exam.title}":`, fetchError.message);
        continue;
      }

      if (existing && existing.length > 0) {
        skippedCount++;
        continue;
      }

      const { error: insertError } = await supabase.from('exams').insert(exam);
      if (insertError) {
        console.error(`[SYNC] Insert failed for "${exam.title}":`, insertError.message);
      } else {
        insertedCount++;
        console.log(`[SYNC] ✓ Inserted: "${exam.title}" (deadline: ${exam.end_date})`);
      }
    } catch (err) {
      console.error(`[SYNC] Exception for "${exam.title}":`, err);
    }
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`  Sync complete. Inserted: ${insertedCount}  |  Skipped (duplicate): ${skippedCount}`);
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('[FATAL] Scraper crashed:', err);
  process.exit(1);
});
