/**
 * ExamGov Portal — Nightly Web Scraper
 * Powered by Playwright (Chromium) + OpenRouter API (meta-llama/llama-3-8b-instruct)
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
const AI_MODEL = 'meta-llama/llama-3-8b-instruct';

const EXTRACTION_PROMPT = `Analyze this raw text from a government exam recruitment portal. Find the active exam notices, recruitment titles, registration start dates, and closing deadlines for the current year 2026/2027. Return a strict JSON array of objects with no markdown wrappers, no backticks, and no extra text in this exact format:
[{"title": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}]
Only return the raw JSON array and nothing else. If no notices are found, return an empty array [].`;

// ──────────────────────────────────────────────────────────────────────────────
// OpenRouter AI extraction helper
// ──────────────────────────────────────────────────────────────────────────────
async function parseHtmlWithOpenRouter(content) {
  const truncatedContent = content.slice(0, 40000);

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
          content: `${EXTRACTION_PROMPT}\n\nRaw Content:\n${truncatedContent}`,
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

  rawContent = rawContent
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  try {
    const parsed = JSON.parse(rawContent);
    return Array.isArray(parsed) ? parsed : [parsed];
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

      const rawText = await page.evaluate(() => document.body.innerText);
      const extractedArray = await parseHtmlWithOpenRouter(rawText);

      for (const extracted of extractedArray) {
        if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) {
          console.warn(`[CUSTOM] Incomplete AI extraction for ${source.url}. Skipping entry.`);
          continue;
        }

        const examPayload = {
          title: extracted.title,
          category: source.category || 'Custom',
          open_date: extracted.start_date,
          end_date: extracted.end_date,
          source_url: source.url,
        };

        const { error: upsertError } = await supabase
          .from('exams')
          .upsert(examPayload, { onConflict: 'source_url' });

        if (upsertError) {
          console.error(`[CUSTOM] Upsert failed for ${source.url}:`, upsertError.message);
        } else {
          console.log(`[CUSTOM] ✓ Upserted: "${extracted.title}" from ${source.url}`);
          customResults.push(examPayload);
        }
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

    const rawText = await page.evaluate(() => document.body.innerText);
    const extractedArray = await parseHtmlWithOpenRouter(rawText);

    for (const extracted of extractedArray) {
      if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) {
        continue;
      }
      results.push({
        title: extracted.title,
        category: 'UPSC',
        open_date: extracted.start_date,
        end_date: extracted.end_date,
        source_url: 'https://upsc.gov.in/examinations/active-examinations',
      });
    }

    console.log(`[UPSC] Extracted ${results.length} record(s) via AI.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[UPSC] AI extraction failed: ${message}.`);
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

    const rawText = await page.evaluate(() => document.body.innerText);
    const extractedArray = await parseHtmlWithOpenRouter(rawText);

    for (const extracted of extractedArray) {
      if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) {
        continue;
      }
      results.push({
        title: extracted.title,
        category: 'SSC',
        open_date: extracted.start_date,
        end_date: extracted.end_date,
        source_url: 'https://ssc.gov.in',
      });
    }

    console.log(`[SSC] Extracted ${results.length} record(s) via AI.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SSC] AI extraction failed: ${message}.`);
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

    const rawText = await page.evaluate(() => document.body.innerText);
    const extractedArray = await parseHtmlWithOpenRouter(rawText);

    for (const extracted of extractedArray) {
      if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) {
        continue;
      }
      results.push({
        title: extracted.title,
        category: 'SSC',
        open_date: extracted.start_date,
        end_date: extracted.end_date,
        source_url: 'https://www.tnpsc.gov.in/english/notification.html',
      });
    }

    console.log(`[TNPSC] Extracted ${results.length} record(s) via AI.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[TNPSC] AI extraction failed: ${message}.`);
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
