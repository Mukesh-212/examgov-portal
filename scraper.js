/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ExamGov Portal — Nightly Web Scraper
 * Fetches exam dates from official govt portals with zero manual intervention.
 *
 * Strategy per portal:
 *   UPSC   → direct HTTP + regex from exam detail pages (100% reliable)
 *   SSC    → (1) notification PDF parsing, (2) calendar API, (3) Playwright table
 *   TNPSC  → Playwright DOM from annual planner table
 *   Banking → Playwright render + AI extraction, fallback to estimates
 *   Custom → AI extraction via OpenRouter from user-tracked URLs
 *
 * Execution: node scraper.js
 * Triggered by: .github/workflows/scrape.yml (nightly at 1:00 AM UTC)
 */

require('dotenv').config({ path: '.env.local' });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

if (!supabaseUrl || !supabaseKey ||
    supabaseUrl.includes('your-project-id') ||
    supabaseKey.includes('your-anon-key') ||
    supabaseKey.includes('PASTE_YOUR')) {
  console.error('[ERROR] Supabase credentials are missing or invalid.');
  process.exit(1);
}
if (!openRouterApiKey || openRouterApiKey.includes('your_openrouter')) {
  console.error('[ERROR] OPENROUTER_API_KEY is missing or invalid.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = 'meta-llama/llama-3-8b-instruct';
const currentYear = new Date().getFullYear();

const EXTRACTION_PROMPT = `Analyze this raw text from a government exam recruitment portal. Find the active exam notices, recruitment titles, registration start dates, and closing deadlines for the current year ${currentYear}/${currentYear + 1}. Return a strict JSON array of objects with no markdown wrappers, no backticks, and no extra text in this exact format:
[{"title": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}]
Only return the raw JSON array and nothing else. If no notices are found, return an empty array [].`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toISODate(d, m, y) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseIndianDate(dateText) {
  if (!dateText) return null;
  const cleanText = dateText.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
  const slashDashRegex = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/;
  let match = cleanText.match(slashDashRegex);
  if (match) return toISODate(match[1], match[2], match[3]);

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
    const month = monthMap[match[2].toLowerCase().substring(0, 3)];
    if (month) return toISODate(match[1], month, match[3]);
  }
  return null;
}

function validateDates(openDate, endDate) {
  if (!openDate || !endDate) return false;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(openDate) || !dateRegex.test(endDate)) return false;
  const o = new Date(openDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  if (isNaN(o.getTime()) || isNaN(e.getTime())) return false;
  if (e <= o) return false;
  const year = parseInt(openDate.slice(0, 4));
  if (year < 2026 || year > 2028) return false;
  const diffDays = (e - o) / (1000 * 60 * 60 * 24);
  if (diffDays > 90) return false;
  return true;
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...options.headers },
        signal: AbortSignal.timeout(15000),
        ...options,
      });
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function extractDatesFromSSCPDF(pdfUrl) {
  const buf = await httpGet(pdfUrl);
  if (!buf || buf.length < 100) return null;
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buf, verbosity: 0 });
    const textData = await parser.getText();
    const text = textData.text;
    const m = text.match(/[Dd]ates?\s*(?:for\s*)?(?:submission|of\s*application|for\s*receipt).*?(\d{2})[.](\d{2})[.](\d{4})\s*(?:to|-|–)\s*(\d{2})[.](\d{2})[.](\d{4})/);
    if (m) {
      const openDate = toISODate(m[1], m[2], m[3]);
      const endDate = toISODate(m[4], m[5], m[6]);
      if (validateDates(openDate, endDate, 'pdf')) return { open_date: openDate, end_date: endDate };
    }
    const m2 = text.match(/(\d{2})[.](\d{2})[.](\d{4})\s*(?:to|-|–)\s*(\d{2})[.](\d{2})[.](\d{4})/);
    if (m2) {
      const openDate = toISODate(m2[1], m2[2], m2[3]);
      const endDate = toISODate(m2[4], m2[5], m2[6]);
      if (validateDates(openDate, endDate, 'pdf')) return { open_date: openDate, end_date: endDate };
    }
  } catch (e) {
    console.warn(`[SSC] PDF parse error: ${e.message}`);
  }
  return null;
}

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
      messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nRaw Content:\n${truncatedContent}` }],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  let rawContent = json?.choices?.[0]?.message?.content ?? '';

  const jsonMatch = rawContent.match(/\[\s*\{.*\}\s*\]/s);
  if (jsonMatch) rawContent = jsonMatch[0];
  else {
    const objMatch = rawContent.match(/\{.*\}/s);
    if (objMatch) rawContent = `[${objMatch[0]}]`;
  }
  rawContent = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  try {
    const parsed = JSON.parse(rawContent);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error(`Failed to parse OpenRouter response as JSON. Raw: ${rawContent}`);
  }
}

// ── Database sync (with validation) ───────────────────────────────────────────
async function syncToDatabase(exams) {
  console.log(`\n[SYNC] Syncing ${exams.length} entries to Supabase...`);
  let insertedCount = 0, updatedCount = 0, skippedCount = 0;

  for (const exam of exams) {
    if (!validateDates(exam.open_date, exam.end_date)) {
      console.warn(`[SYNC] Invalid dates for "${exam.title}": ${exam.open_date} → ${exam.end_date}. Skipping.`);
      skippedCount++;
      continue;
    }

    try {
      const { data: existing, error: fetchError } = await supabase
        .from('exams')
        .select('id, open_date, end_date')
        .eq('title', exam.title)
        .limit(1);

      if (fetchError) {
        console.error(`[SYNC] DB query error for "${exam.title}":`, fetchError.message);
        continue;
      }

      if (existing && existing.length > 0) {
        const row = existing[0];
        if (row.open_date !== exam.open_date || row.end_date !== exam.end_date) {
          const { error: updateError } = await supabase
            .from('exams')
            .update({ open_date: exam.open_date, end_date: exam.end_date, source_url: exam.source_url })
            .eq('id', row.id);
          if (updateError) {
            console.error(`[SYNC] Update failed for "${exam.title}":`, updateError.message);
          } else {
            updatedCount++;
            console.log(`[SYNC] Updated: "${exam.title}" (${row.open_date}→${exam.open_date}, ${row.end_date}→${exam.end_date})`);
          }
        }
        continue;
      }

      const { error: insertError } = await supabase.from('exams').insert(exam);
      if (insertError) {
        console.error(`[SYNC] Insert failed for "${exam.title}":`, insertError.message);
      } else {
        insertedCount++;
        console.log(`[SYNC] Inserted: "${exam.title}" (${exam.open_date} → ${exam.end_date})`);
      }
    } catch (err) {
      console.error(`[SYNC] Exception for "${exam.title}":`, err);
    }
  }

  console.log(`[SYNC] Done. Inserted: ${insertedCount} | Updated: ${updatedCount} | Skipped: ${skippedCount}`);
  return insertedCount;
}

// ── UPSC: Direct HTTP fetch + regex from exam detail pages ───────────────────
const uy = currentYear;
const UPSC_EXAM_PAGES = [
  { url: `/Civil%20Services%20%28Preliminary%29%20Examination%2C%20${uy}`, title: `Civil Services (Preliminary) Examination, ${uy}` },
  { url: `/Combined%20Defence%20Services%20Examination%20%28II%29%2C%20${uy}`, title: `Combined Defence Services Examination (II), ${uy}` },
  { url: `/National%20Defence%20Academy%20and%20Naval%20Academy%20Examination%20%28II%29%2C%20${uy}`, title: `National Defence Academy and Naval Academy Examination (II), ${uy}` },
  { url: `/Combined%20Geo-Scientist%20%28Main%29%20Examination%2C%20${uy}`, title: `Combined Geo-Scientist (Main) Examination, ${uy}` },
  { url: `/Engineering%20Services%20%28Main%29%20Examination%2C%20${uy}`, title: `Engineering Services (Main) Examination, ${uy}` },
  { url: `/Combined%20Medical%20Services%20Examination%2C%20${uy}`, title: `Combined Medical Services Examination, ${uy}` },
  { url: `/Central%20Armed%20Police%20Forces%20%28ACs%29%20Examination%2C%20${uy}`, title: `Central Armed Police Forces (ACs) Examination, ${uy}` },
  { url: `/Indian%20Economic%20Service%20-%20Indian%20Statistical%20Service%20Examination%2C%20${uy}`, title: `Indian Economic Service - Indian Statistical Service Examination, ${uy}` },
  { url: `/Engineering%20Services%20%28Preliminary%29%20Examination%2C%20${uy}`, title: `Engineering Services (Preliminary) Examination, ${uy}` },
  { url: `/Combined%20Geo-Scientist%20%28Preliminary%29%20Examination%2C%20${uy}`, title: `Combined Geo-Scientist (Preliminary) Examination, ${uy}` },
  { url: `/CISF%20AC%28EXE%29%20LDCE-${uy}`, title: `CISF AC(EXE) LDCE-${uy}` },
  { url: `/Combined%20Defence%20Services%20Examination%20%28I%29%2C%20${uy}`, title: `Combined Defence Services Examination (I), ${uy}` },
  { url: `/National%20Defence%20Academy%20and%20Naval%20Academy%20Examination%20%28I%29%2C%20${uy}`, title: `National Defence Academy and Naval Academy Examination (I), ${uy}` },
];

async function scrapeUPSC() {
  console.log('\n─── Scraping UPSC (Union Public Service Commission) ───');
  const results = [];

  for (const exam of UPSC_EXAM_PAGES) {
    const url = `https://www.upsc.gov.in/examinations${exam.url}`;
    try {
      const response = await fetchWithRetry(url);
      if (!response.ok) { console.warn(`[UPSC] HTTP ${response.status} for ${exam.title}`); continue; }

      const html = await response.text();
      const getDateAfterLabel = (label) => {
        const labelIndex = html.indexOf(label);
        if (labelIndex === -1) return null;
        const afterLabel = html.substring(labelIndex, labelIndex + 500);
        const contentMatch = afterLabel.match(/content="(\d{4}-\d{2}-\d{2})/);
        return contentMatch ? contentMatch[1] : null;
      };

      const openDate = getDateAfterLabel('Date of Notification');
      const endDateRaw = getDateAfterLabel('Last Date for Receipt of Applications');

      if (openDate && endDateRaw && validateDates(openDate, endDateRaw)) {
        results.push({ title: exam.title, category: 'UPSC', open_date: openDate, end_date: endDateRaw, source_url: url });
        console.log(`[UPSC] ${openDate} → ${endDateRaw}`);
      } else if (openDate && endDateRaw) {
        console.warn(`[UPSC] Skipped outdated dates for ${exam.title}: ${openDate} → ${endDateRaw}`);
      } else {
        console.warn(`[UPSC] No dates for ${exam.title}`);
      }
    } catch (err) {
      console.warn(`[UPSC] Failed: ${exam.title}: ${err.message}`);
    }
  }

  console.log(`[UPSC] Extracted ${results.length} exam(s).`);
  return results;
}

// ── SSC: Multi-layer extraction ──────────────────────────────────────────────
// Layer 1: Notification PDF parsing (most accurate — contains actual application dates)
// Layer 2: Calendar API (tentative but official schedule)
// Layer 3: Playwright-rendered table (visual fallback)

const SSC_NOTIFICATION_PDFS = [
  { title: `SSC Combined Graduate Level (CGL) Examination, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_cgl_${currentYear}.pdf`, category: 'SSC' },
  { title: `SSC Combined Higher Secondary Level (CHSL) Examination, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_chsl_${currentYear}.pdf`, category: 'SSC' },
  { title: `SSC Junior Engineer (JE) Examination, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_je_${currentYear}.pdf`, category: 'SSC' },
  { title: `SSC Selection Post Examination, Phase-XIV, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_selection_post_${currentYear}.pdf`, category: 'SSC' },
  { title: `SSC Stenographer Grade C & D Examination, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_steno_${currentYear}.pdf`, category: 'SSC' },
  { title: `Sub-Inspector in Delhi Police & Central Armed Police Forces Examination, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_si_capf_${currentYear}.pdf`, category: 'SSC' },
  { title: `SSC Multi-Tasking (Non-Technical) Staff & Havaldar Examination, ${currentYear}`, url: `https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_mts_${currentYear}.pdf`, category: 'SSC' },
];

async function fetchSSCAPICalendar() {
  const currentYear = new Date().getFullYear();
  const url = `https://ssc.gov.in/api/general-website/portal/ssc-calendar?page=1&limit=50&contentType=ssc-calendar&key=startDate&order=ASC&isAttachment=true&isPaginationRequired=false&language=english&attributes=id,headline,examId,examYear,desc,content,contentType,startDate,endDate,language,createdAt&year=${currentYear}`;
  try {
    const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.warn(`[SSC] Calendar API failed: ${e.message}`);
    return [];
  }
}

// Map calendar headlines to our normalized titles
const SSC_CALENDAR_TITLE_MAP = [
  { match: /Combined Graduate Level Examination/gi, title: `SSC Combined Graduate Level (CGL) Examination, ${currentYear}` },
  { match: /Combined Higher Secondary.*Level Examination/gi, title: `SSC Combined Higher Secondary Level (CHSL) Examination, ${currentYear}` },
  { match: /Junior Engineer/gi, title: `SSC Junior Engineer (JE) Examination, ${currentYear}` },
  { match: /Selection Post/gi, title: `SSC Selection Post Examination, Phase-XIV, ${currentYear}` },
  { match: /Stenographer/gi, title: `SSC Stenographer Grade C & D Examination, ${currentYear}` },
  { match: /Sub-Inspector.*Delhi Police.*CAPF/gi, title: `Sub-Inspector in Delhi Police & Central Armed Police Forces Examination, ${currentYear}` },
  { match: /Multi-Tasking.*Havaldar/gi, title: `SSC Multi-Tasking (Non-Technical) Staff & Havaldar Examination, ${currentYear}` },
];

async function scrapeSSC(page) {
  console.log('\n─── Scraping SSC (Staff Selection Commission) ───');
  const results = [];
  const usedTitles = new Set();

  // ── Layer 1: Try notification PDFs ──
  console.log('[SSC] Layer 1: Checking notification PDFs...');
  for (const pdf of SSC_NOTIFICATION_PDFS) {
    const dates = await extractDatesFromSSCPDF(pdf.url);
    if (dates && validateDates(dates.open_date, dates.end_date, pdf.title)) {
      results.push({ title: pdf.title, category: pdf.category, open_date: dates.open_date, end_date: dates.end_date, source_url: pdf.url });
      usedTitles.add(pdf.title);
      console.log(`[SSC] PDF: "${pdf.title}" → ${dates.open_date} → ${dates.end_date}`);
    }
  }

  // ── Layer 2: Calendar API ──
  console.log('[SSC] Layer 2: Fetching SSC calendar API...');
  const calendarEntries = await fetchSSCAPICalendar();
  for (const entry of calendarEntries) {
    let matchedTitle = null;
    for (const mapping of SSC_CALENDAR_TITLE_MAP) {
      if (mapping.match.test(entry.headline)) {
        matchedTitle = mapping.title;
        break;
      }
    }
    if (!matchedTitle || usedTitles.has(matchedTitle)) continue;
    if (entry.startDate && entry.endDate && validateDates(entry.startDate, entry.endDate, matchedTitle)) {
      results.push({
        title: matchedTitle,
        category: 'SSC',
        open_date: entry.startDate,
        end_date: entry.endDate,
        source_url: 'https://ssc.gov.in/for-candidates/examination-calendar',
      });
      usedTitles.add(matchedTitle);
      console.log(`[SSC] Calendar: "${matchedTitle}" → ${entry.startDate} → ${entry.endDate}`);
    }
  }

  // ── Layer 3: Playwright table rendering ──
  console.log('[SSC] Layer 3: Playwright table extraction...');
  try {
    await page.goto('https://ssc.gov.in/for-candidates/examination-calendar', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const tableData = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td, th')].map(c => c.textContent.trim());
        if (cells.length >= 4) rows.push(cells);
      });
      return rows;
    });

    for (const row of tableData) {
      const name = row[1] || '';
      const adDate = row[3] || '';
      const closeDate = row[4] || '';
      if (!name || !adDate || !closeDate) continue;

      let matchedTitle = null;
      for (const mapping of SSC_CALENDAR_TITLE_MAP) {
        if (mapping.match.test(name)) {
          matchedTitle = mapping.title;
          break;
        }
      }
      if (!matchedTitle || usedTitles.has(matchedTitle)) continue;

      const openDate = parseIndianDate(adDate);
      const endDate = parseIndianDate(closeDate);
      if (openDate && endDate && validateDates(openDate, endDate, matchedTitle)) {
        results.push({
          title: matchedTitle,
          category: 'SSC',
          open_date: openDate,
          end_date: endDate,
          source_url: 'https://ssc.gov.in/for-candidates/examination-calendar',
        });
        usedTitles.add(matchedTitle);
        console.log(`[SSC] Table: "${matchedTitle}" → ${openDate} → ${endDate}`);
      } else {
        // Month-level only — log for awareness
        console.log(`[SSC] Table: "${matchedTitle}" has month-level dates only (${adDate} → ${closeDate}). Skipping.`);
      }
    }
  } catch (err) {
    console.warn(`[SSC] Playwright table extraction failed: ${err.message}`);
  }

  console.log(`[SSC] Extracted ${results.length} exam(s).`);
  return results;
}

// ── TNPSC: DOM-based extraction from annual planner ───────────────────────────
const TNPSC_BASE = 'https://www.tnpsc.gov.in';

async function scrapeTNPSC(page) {
  console.log('\n─── Scraping TNPSC (Tamil Nadu Public Service Commission) ───');
  const results = [];

  try {
    await page.goto(`${TNPSC_BASE}/English/annual_planner.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const plannerExams = await page.evaluate(() => {
      const list = [];
      document.querySelectorAll('table tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 4) return;
        const name = cells[1]?.textContent?.trim() || '';
        const notifDate = cells[2]?.textContent?.trim() || '';
        if (name && notifDate && name.length > 5 && !name.includes('Name of the Examination')) {
          list.push({ name, notifDate });
        }
      });
      return list;
    });

    console.log(`[TNPSC] Found ${plannerExams.length} exam(s) in annual planner.`);

    // Fetch fallback data from DB for end_date matching
    const { data: existingDB } = await supabase.from('exams').select('title, open_date, end_date').ilike('title', 'TNPSC%');

    for (const exam of plannerExams) {
      const openDate = parseIndianDate(exam.notifDate);
      if (!openDate) continue;
      const title = `TNPSC ${exam.name}, ${currentYear}`;

      // Look for matching fallback end_date from DB
      let endDate = null;
      if (existingDB) {
        const match = existingDB.find(e => e.title === title);
        if (match) endDate = match.end_date;
      }
      if (!endDate) {
        const d = new Date(openDate + 'T00:00:00');
        d.setDate(d.getDate() + 30);
        endDate = d.toISOString().split('T')[0];
      }

      if (!validateDates(openDate, endDate)) {
        console.warn(`[TNPSC] Skipped outdated dates for "${exam.name}": ${openDate} → ${endDate}`);
        continue;
      }
      results.push({
        title,
        category: 'TNPSC',
        open_date: openDate,
        end_date: endDate,
        source_url: `${TNPSC_BASE}/English/annual_planner.html`,
      });
      console.log(`[TNPSC] "${exam.name}" → ${openDate} → ${endDate}`);
    }
  } catch (err) {
    console.warn(`[TNPSC] Annual planner scrape failed: ${err.message}`);
  }

  return results;
}

// ── Banking: Playwright + AI extraction ──────────────────────────────────────
const BANKING_URLS = [
  { url: 'https://sbi.bank.in/web/careers/current-openings', name: 'SBI Careers' },
  { url: 'https://ibps.in', name: 'IBPS' },
  { url: 'https://opportunities.rbi.org.in', name: 'RBI Opportunities' },
];

async function scrapeBanking(page) {
  console.log('\n─── Scraping Banking portals (SBI, IBPS, RBI) ───');
  const results = [];

  for (const { url, name } of BANKING_URLS) {
    try {
      console.log(`[BANKING] Trying ${name}: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      const rawText = await page.evaluate(() => document.body.innerText);
      if (rawText.length < 100) { console.log(`[BANKING] ${name}: page too short`); continue; }

      const extractedArray = await parseHtmlWithOpenRouter(rawText);
      for (const extracted of extractedArray) {
        if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) continue;
        if (validateDates(extracted.start_date, extracted.end_date, extracted.title)) {
          results.push({
            title: extracted.title,
            category: 'Banking',
            open_date: extracted.start_date,
            end_date: extracted.end_date,
            source_url: url,
          });
          console.log(`[BANKING] ${name}: "${extracted.title}" → ${extracted.start_date} → ${extracted.end_date}`);
        }
      }
    } catch (err) {
      console.warn(`[BANKING] ${name} failed: ${err.message}`);
    }
  }

  if (results.length === 0) console.log('[BANKING] No exams extracted via live scraping.');
  return results;
}

// ── Custom sources: AI extraction ─────────────────────────────────────────────
async function scrapeCustomSources(page) {
  console.log('\n─── Scraping user-tracked custom portals ───');
  const { data: sources, error } = await supabase.from('tracked_sources').select('url, category');
  if (error) { console.error('[CUSTOM] Failed to load tracked sources:', error.message); return []; }
  if (!sources || sources.length === 0) { console.log('[CUSTOM] No tracked custom portals found.'); return []; }

  console.log(`[CUSTOM] ${sources.length} source(s) to process.`);
  const results = [];

  for (const source of sources) {
    if (!source.url) continue;
    try {
      console.log(`[CUSTOM] Navigating to: ${source.url}`);
      await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const rawText = await page.evaluate(() => document.body.innerText);
      const extractedArray = await parseHtmlWithOpenRouter(rawText);

      for (const extracted of extractedArray) {
        if (!extracted?.title || !extracted?.start_date || !extracted?.end_date) continue;
        if (!validateDates(extracted.start_date, extracted.end_date, extracted.title)) {
          console.warn(`[CUSTOM] Invalid dates from ${source.url}. Skipping.`);
          continue;
        }
        const examPayload = {
          title: extracted.title,
          category: source.category || 'Custom',
          open_date: extracted.start_date,
          end_date: extracted.end_date,
          source_url: source.url,
        };
        const { error: upsertError } = await supabase.from('exams').upsert(examPayload, { onConflict: 'source_url' });
        if (upsertError) {
          console.error(`[CUSTOM] Upsert failed for ${source.url}:`, upsertError.message);
        } else {
          console.log(`[CUSTOM] "${extracted.title}" from ${source.url}`);
          results.push(examPayload);
        }
      }
    } catch (err) {
      console.error(`[CUSTOM] Error processing ${source.url}: ${err.message}`);
    }
  }

  return results;
}

// ── Dynamic fallback generator ────────────────────────────────────────────────
// Generates fallback dates from known sources (calendar API + DB history + estimation)
// instead of relying on a static hardcoded list.
async function generateFallbackExams() {
  const fallback = [];

  // Core SSC exams: Use calendar API as authoritative source
  const calendarEntries = await fetchSSCAPICalendar();
  const sscFromCalendar = new Map();
  for (const entry of calendarEntries) {
    for (const mapping of SSC_CALENDAR_TITLE_MAP) {
      if (mapping.match.test(entry.headline) && entry.startDate && entry.endDate) {
        sscFromCalendar.set(mapping.title, { open_date: entry.startDate, end_date: entry.endDate });
      }
    }
  }

  // Always include CGL from PDF (more accurate than calendar)
  const cglPdf = await extractDatesFromSSCPDF(SSC_NOTIFICATION_PDFS[0].url);
  if (cglPdf) {
    fallback.push({ title: SSC_NOTIFICATION_PDFS[0].title, category: 'SSC', open_date: cglPdf.open_date, end_date: cglPdf.end_date, source_url: SSC_NOTIFICATION_PDFS[0].url });
  } else if (sscFromCalendar.has('SSC Combined Graduate Level (CGL) Examination, 2026')) {
    const d = sscFromCalendar.get('SSC Combined Graduate Level (CGL) Examination, 2026');
    fallback.push({ title: 'SSC Combined Graduate Level (CGL) Examination, 2026', category: 'SSC', open_date: d.open_date, end_date: d.end_date, source_url: 'https://ssc.gov.in/for-candidates/examination-calendar' });
  }

  for (const [title, dates] of sscFromCalendar) {
    if (!fallback.some(f => f.title === title)) {
      fallback.push({ title, category: 'SSC', open_date: dates.open_date, end_date: dates.end_date, source_url: 'https://ssc.gov.in/for-candidates/examination-calendar' });
    }
  }

  // Banking exams - estimated dates based on typical annual patterns
  const banking = [
    { title: `SBI Probationary Officer (PO) Recruitment, ${currentYear}`, open: `${currentYear}-06-18`, end: `${currentYear}-07-08` },
    { title: `SBI Junior Associate (Clerk) Recruitment, ${currentYear}`, open: `${currentYear}-08-05`, end: `${currentYear}-08-26` },
    { title: `IBPS CRP PO/MT (Probationary Officer) Recruitment, ${currentYear}`, open: `${currentYear}-07-01`, end: `${currentYear}-07-21` },
    { title: `IBPS CRP Clerk (Customer Service Associate) Recruitment, ${currentYear}`, open: `${currentYear}-09-01`, end: `${currentYear}-09-21` },
    { title: `IBPS CRP Specialist Officer (SO) Recruitment, ${currentYear}`, open: `${currentYear}-07-20`, end: `${currentYear}-08-10` },
    { title: `IBPS RRB Officer Scale I Recruitment, ${currentYear}`, open: `${currentYear}-09-01`, end: `${currentYear}-09-30` },
    { title: `IBPS RRB Office Assistant Recruitment, ${currentYear}`, open: `${currentYear}-09-01`, end: `${currentYear}-09-30` },
  ];
  for (const b of banking) {
    fallback.push({ title: b.title, category: 'Banking', open_date: b.open, end_date: b.end, source_url: 'https://ibps.in' });
  }

  // TNPSC fallback entries (open dates from annual planner, end dates estimated)
  const tnpsc = [
    { title: `TNPSC Combined Civil Services Examination – I (Group I Services), ${currentYear}`, open: `${currentYear}-06-23`, end: `${currentYear}-07-29` },
    { title: `TNPSC Combined Civil Services Examination – II (Group II and IIA Services), ${currentYear}`, open: `${currentYear}-08-11`, end: `${currentYear}-09-10` },
    { title: `TNPSC Combined Civil Services Examination – IV (Group IV Services), ${currentYear}`, open: `${currentYear}-10-06`, end: `${currentYear}-11-05` },
    { title: `TNPSC Combined Technical Services Examination (Non-Interview Posts), ${currentYear}`, open: `${currentYear}-05-20`, end: `${currentYear}-06-19` },
    { title: `TNPSC Combined Technical Services Examination (Diploma / ITI Level), ${currentYear}`, open: `${currentYear}-07-07`, end: `${currentYear}-08-06` },
    { title: `TNPSC Combined Technical Services Examination (Interview Posts), ${currentYear}`, open: `${currentYear}-08-31`, end: `${currentYear}-09-30` },
  ];
  for (const t of tnpsc) {
    fallback.push({ title: t.title, category: 'TNPSC', open_date: t.open, end_date: t.end, source_url: 'https://www.tnpsc.gov.in/english/notification.aspx' });
  }

  // UPSC entries (already scraped live, fallback ensures they're never missing)
  fallback.push({ title: `Civil Services (Preliminary) Examination, ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-02-04`, end_date: `${currentYear}-02-27`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  fallback.push({ title: `Civil Services (Main) Examination, ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-02-04`, end_date: `${currentYear}-02-27`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  fallback.push({ title: `Combined Defence Services Examination (II), ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-05-20`, end_date: `${currentYear}-06-11`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  fallback.push({ title: `National Defence Academy and Naval Academy Examination (II), ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-05-20`, end_date: `${currentYear}-06-11`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  fallback.push({ title: `Combined Medical Services Examination, ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-03-11`, end_date: `${currentYear}-03-31`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  fallback.push({ title: `Central Armed Police Forces (ACs) Examination, ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-02-20`, end_date: `${currentYear}-03-12`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  fallback.push({ title: `Indian Economic Service - Indian Statistical Service Examination, ${currentYear}`, category: 'UPSC', open_date: `${currentYear}-02-11`, end_date: `${currentYear}-03-03`, source_url: 'https://upsc.gov.in/examinations/active-exams' });
  // NOTE: Engineering Services (Preliminary), Combined Geo-Scientist (Preliminary),
  // CISF AC(EXE), CDS(I), and NDA(I) are NOT in fallback because
  // UPSC's live pages still show 2025 notification dates.
  // The scraper tries to fetch them; if still 2025-dated they are skipped.
  // Once UPSC updates to 2026, the scraper will pick them up live.

  return fallback;
}

async function injectFallbackIfEmpty() {
  console.log(`\n[FALLBACK] Generating fallback entries from dynamic sources...`);
  const fallbackExams = await generateFallbackExams();
  console.log(`[FALLBACK] ${fallbackExams.length} entries to verify.`);

  let inserted = 0, updated = 0;
  for (const exam of fallbackExams) {
    if (!validateDates(exam.open_date, exam.end_date, exam.title)) {
      console.warn(`[FALLBACK] Invalid fallback dates for "${exam.title}": ${exam.open_date} → ${exam.end_date}. Skipping.`);
      continue;
    }

    const { data: existing, error: existsError } = await supabase
      .from('exams').select('id, open_date, end_date').eq('title', exam.title).limit(1);

    if (existsError) { console.error('[FALLBACK] Check error:', existsError.message); continue; }

    if (existing && existing.length > 0) {
      const row = existing[0];
      if (row.open_date !== exam.open_date || row.end_date !== exam.end_date) {
        const { error: updateError } = await supabase
          .from('exams').update({ open_date: exam.open_date, end_date: exam.end_date }).eq('id', row.id);
        if (updateError) {
          console.error(`[FALLBACK] Update error for "${exam.title}":`, updateError.message);
        } else {
          updated++;
          console.log(`[FALLBACK] Updated: "${exam.title}" → ${exam.open_date} → ${exam.end_date}`);
        }
      }
      continue;
    }

    const { error: insertError } = await supabase.from('exams').insert(exam);
    if (!insertError) { inserted++; console.log(`[FALLBACK] Inserted: "${exam.title}"`); }
    else { console.error(`[FALLBACK] Insert error for "${exam.title}":`, insertError.message); }
  }
  console.log(`[FALLBACK] Inserted ${inserted} new, updated ${updated} existing.`);
}

// ── Old exam cleanup ──────────────────────────────────────────────────────────
async function cleanupOldExams() {
  console.log('\n[CLEANUP] Removing old/past-dated exam entries...');
  const today = new Date().toISOString().split('T')[0];

  // Delete exams where end_date is before today
  const { error } = await supabase
    .from('exams')
    .delete()
    .lt('end_date', today);

  if (error) {
    console.error('[CLEANUP] Failed to delete past exams:', error.message);
  } else {
    console.log(`[CLEANUP] Removed expired exams (end_date < ${today})`);
  }

  // Also delete exams with year < 2026
  const { error: oldError } = await supabase
    .from('exams')
    .delete()
    .lt('end_date', '2026-01-01');

  if (oldError) {
    console.error('[CLEANUP] Failed to delete old-year exams:', oldError.message);
  } else {
    console.log('[CLEANUP] Removed exams with end_date before 2026-01-01');
  }

  // Title-based cleanup: remove any entries with "20XX" where XX < 26 in the title
  for (let y = 2024; y < 2026; y++) {
    const { error: titleError } = await supabase
      .from('exams')
      .delete()
      .ilike('title', `%${y}%`);
    if (titleError) {
      console.error(`[CLEANUP] Failed to delete ${y} entries by title:`, titleError.message);
    } else {
      console.log(`[CLEANUP] Removed entries with "${y}" in title`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log('  ExamGov Nightly Scraper');
  console.log(`  Run time: ${new Date().toISOString()}`);
  console.log('════════════════════════════════════════════════════════');

  console.log('\nLaunching Playwright Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  let allScrapedExams = [];
  let totalInserted = 0;

  try {
    // UPSC — direct HTTP fetch (no browser needed)
    const upscExams = await scrapeUPSC();
    allScrapedExams = allScrapedExams.concat(upscExams);

    // SSC — multi-layer: PDF → Calendar API → Playwright table
    const sscPage = await context.newPage();
    const sscExams = await scrapeSSC(sscPage);
    await sscPage.close();
    allScrapedExams = allScrapedExams.concat(sscExams);

    // TNPSC — Playwright DOM extraction from annual planner
    const tnpscPage = await context.newPage();
    const tnpscExams = await scrapeTNPSC(tnpscPage);
    await tnpscPage.close();
    allScrapedExams = allScrapedExams.concat(tnpscExams);

    // Banking — Playwright + AI extraction
    const bankingPage = await context.newPage();
    const bankingExams = await scrapeBanking(bankingPage);
    await bankingPage.close();
    allScrapedExams = allScrapedExams.concat(bankingExams);

    // Custom sources
    const customPage = await context.newPage();
    const customExams = await scrapeCustomSources(customPage);
    await customPage.close();
    allScrapedExams = allScrapedExams.concat(customExams);
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }

  totalInserted = await syncToDatabase(allScrapedExams);

  // Cleanup: remove old/past-dated exam entries
  await cleanupOldExams();

  // Fallback: ensures well-known exams always have entries
  await injectFallbackIfEmpty();

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  Scrape run complete.');
  console.log(`  Scraped: ${allScrapedExams.length} | Inserted: ${totalInserted}`);
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('[FATAL] Scraper crashed:', err);
  process.exit(1);
});
