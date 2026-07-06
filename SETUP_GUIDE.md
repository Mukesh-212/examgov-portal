# Exam Portal - Complete Setup & Running Guide

## ✅ Project Status: WORKING

Your complete exam notification system is now **fully functional and running**. The system automatically scrapes government exam websites and sends deadline reminders to subscribed users.

---

## 🚀 Quick Start

### Running the Application

**Development Server:**
```bash
npm run dev
```
- Server will start on **http://localhost:3000**
- Open in browser to use the portal

**Production Build:**
```bash
npm run build
npm start
```

**Scraper (Manual Run):**
```bash
node scraper.js
```
- Fetches latest exam deadlines from government websites
- Inserts new exams into Supabase
- Can be scheduled with GitHub Actions (see `.github/workflows/scrape.yml`)

**Check Reminders (Manual Trigger):**
```bash
curl -X GET http://localhost:3000/api/check-reminders \
  -H "Authorization: Bearer 199021e9bc69c70af869a5fad9799b2105f6d818b3a306254b1aae016e15361d"
```

---

## 📋 Environment Variables Setup

All required environment variables are already configured in `.env.local`:

```env
# Supabase Configuration (Already Set)
NEXT_PUBLIC_SUPABASE_URL=https://ykwgcvomtpuximdwvifv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OpenRouter AI (Already Set)
OPENROUTER_API_KEY=sk-or-v1-...

# Gmail SMTP (Already Set)
EMAIL_USER=mukessh218@gmail.com
EMAIL_PASS=pass

# Cron Secret (Already Set)
CRON_SECRET=199021e9bc69c70af869a5fad9799b2105f6d818b3a306254b1aae016e15361d
```

**⚠️ If You Need to Update These:**
- **OPENROUTER_API_KEY**: Get from https://openrouter.ai/keys
- **EMAIL_USER & EMAIL_PASS**: Gmail credentials (App Password from https://myaccount.google.com/apppasswords)
- **CRON_SECRET**: Any long random string for Bearer token authorization

---

## 🗄️ Supabase Database Setup

Your system uses these three Supabase tables:

### 1. **exams** table
```sql
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,  -- UPSC, SSC, Banking, Railways
  open_date DATE,
  end_date DATE NOT NULL,
  source_url TEXT,
  created_at TIMESTAMP DEFAULT now()
);
```

### 2. **subscribers** table
```sql
CREATE TABLE subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  subscribed_categories TEXT[] NOT NULL,  -- Array of categories
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

### 3. **tracked_sources** table
```sql
CREATE TABLE tracked_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

**To create these tables:**
1. Visit your Supabase project: https://supabase.com/dashboard
2. Go to SQL Editor
3. Copy and run the above SQL commands
4. Tables will auto-populate as users interact with the app

---

## 🎯 Feature Walkthrough

### 1. **Dashboard (Main Page)**
- **Exams Tab**: View all upcoming exam registrations with deadlines
- **Subscription Tab**: Subscribe to exam categories (UPSC, SSC, Banking, Railways)
- **Track Portal Button**: Add custom exam portal URLs for monitoring
- **Notifications & Resources Tabs**: Placeholder pages for future content

### 2. **Subscription System**
- Users enter email and select categories
- System stores preferences in `subscribers` table
- When exams close in 3 days, automatic reminders sent to all subscribed users

### 3. **Custom Portal Tracking**
- Users submit government exam website URLs via the "Track Portal" modal
- AI (OpenRouter/Llama) extracts exam title, start date, and deadline from the HTML
- New exams automatically appear in the Exams tab

### 4. **Automatic Scraping**
- `scraper.js` fetches exams from UPSC, SSC, TNPSC websites
- Uses Playwright to handle JavaScript-rendered pages
- Parses dates with AI assistance
- Inserts new exams into Supabase
- Falls back to simulated data if websites block scraping

### 5. **Email Reminders**
- Runs every night (configured in `.github/workflows/scrape.yml`)
- Finds exams closing in exactly 3 days
- Queries subscribers interested in that exam category
- Sends professional HTML reminder emails
- Includes exam details and registration link

---

## 📁 Project Structure

```
project 1/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main dashboard
│   │   ├── layout.tsx            # App layout with fonts
│   │   ├── globals.css           # Tailwind CSS
│   │   ├── api/
│   │   │   ├── subscribe/        # POST/GET/PATCH/DELETE subscribers
│   │   │   ├── track-custom-url/ # POST to add exam portal URLs
│   │   │   ├── check-reminders/  # GET to send reminder emails
│   │   │   └── admin/            # Admin exam management API
│   │   └── admin/                # Admin page (placeholder)
│   └── lib/
│       └── supabase.ts           # Supabase client initialization
├── scraper.js                    # Node.js script to fetch exams nightly
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── tailwind.config.mjs           # Tailwind CSS config
├── next.config.ts                # Next.js config
├── .env.local                    # Environment variables (ALL SET UP)
└── .github/
    └── workflows/
        └── scrape.yml            # GitHub Actions nightly scraper
```

---

## 🔧 API Endpoints Reference

### POST /api/subscribe
**Add or update user subscription**
```json
{
  "email": "user@example.com",
  "categories": ["UPSC", "Banking"]
}
```

### GET /api/subscribe?email=user@example.com
**Retrieve subscriber preferences**

### PATCH /api/subscribe
**Update subscription categories**
```json
{
  "email": "user@example.com",
  "categories": ["SSC", "Railways"]
}
```

### DELETE /api/subscribe?email=user@example.com
**Unsubscribe user**

### POST /api/track-custom-url
**Submit exam portal URL for monitoring**
```json
{
  "url": "https://example.com/exam-notice",
  "category": "UPSC"
}
```

### GET /api/check-reminders
**Send reminder emails for exams closing in 3 days**
- **Requires**: `Authorization: Bearer ${CRON_SECRET}` header
- **Returns**: Count of exams and emails sent

### POST /api/admin/exams
**Manually add exam record (admin use)**
```json
{
  "title": "Exam Name",
  "category": "UPSC",
  "open_date": "2025-01-01",
  "end_date": "2025-03-31",
  "source_url": "https://..."
}
```

---

## 🧪 Testing the System End-to-End

### Step 1: Subscribe to Notifications
1. Open **http://localhost:3000**
2. Click "Subscription" tab
3. Enter your email and select categories
4. Click "Activate Free Alerts"
5. ✅ You're subscribed!

### Step 2: Add Custom Exam Portal
1. Click "Track Portal +" button
2. Paste an exam website URL (e.g., https://upsc.gov.in)
3. Select a category
4. Click "Submit Portal"
5. ✅ System will scrape the URL and extract exam dates

### Step 3: View Exams
1. Click "Exams" tab
2. See all registered exams with deadlines
3. Filter by category using the left sidebar
4. Click "View" to go to official registration page

### Step 4: Test Email Reminders (Manual)
```bash
# In terminal, run:
curl -X GET http://localhost:3000/api/check-reminders \
  -H "Authorization: Bearer 199021e9bc69c70af869a5fad9799b2105f6d818b3a306254b1aae016e15361d"
```
- If exams exist closing in 3 days, emails will be sent
- Check your inbox (it may take a minute)

### Step 5: Run Scraper Manually
```bash
node scraper.js
```
- Fetches latest exams from UPSC, SSC, TNPSC
- Inserts new ones into database
- Shows progress in terminal

---

## 📊 Database Status

### Current Data
The scraper has already inserted sample exams:
- Civil Services (Preliminary) Examination 2025 (UPSC)
- Combined Graduate Level Examination (CGL) 2025 (SSC)
- TNPSC Group II Recruitment Services Notification 2025

### To Check Database
Visit Supabase Dashboard → SQL Editor → Run:
```sql
SELECT * FROM exams;
SELECT * FROM subscribers;
SELECT * FROM tracked_sources;
```

---

## 🔄 Automation with GitHub Actions

The project includes automated nightly scraping. To enable:

1. **Push code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/exam-portal.git
   git push -u origin main
   ```

2. **Add Secrets to GitHub**
   - Go to GitHub repo → Settings → Secrets → New repository secret
   - Add: `OPENROUTER_API_KEY`, `EMAIL_USER`, `EMAIL_PASS`, `CRON_SECRET`
   - Add: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

3. **Scraper runs automatically at 2 AM UTC daily** (configured in `.github/workflows/scrape.yml`)

---

## 🐛 Troubleshooting

### Dev server won't start
```bash
# Kill existing process
taskkill /PID 29188 /F
# Or find Node process: netstat -ano | findstr :3000
# Then: npm run dev
```

### Scraper fails
```bash
# Check environment variables loaded
node -e "require('dotenv').config({path:'.env.local'}); console.log(process.env.OPENROUTER_API_KEY);"

# Should output your API key, not empty
```

### Emails not sending
- ✅ EMAIL_USER is set to your Gmail address
- ✅ EMAIL_PASS is Gmail **App Password** (not regular password)
- ✅ Check Supabase subscribers table for email addresses
- ✅ Check exams table for end dates = today + 3 days

### Supabase connection fails
- Verify `NEXT_PUBLIC_SUPABASE_URL` is correct
- Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is valid
- Test: `node -e "require('dotenv').config({path:'.env.local'}); const {createClient}=require('@supabase/supabase-js'); const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); console.log('✓ Connected');"`

---

## 📦 Technologies Used

| Component | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.2.10 | React framework with server/client components |
| React | 19.2.4 | UI library |
| TypeScript | 5 | Type-safe JavaScript |
| Tailwind CSS | 4 | Styling |
| Supabase | 2.110.0 | PostgreSQL backend & auth |
| Playwright | 1.61.1 | Browser automation for scraping |
| @google/generative-ai | 0.24.1 | Google AI SDK for AI features |
| Nodemailer | 9.0.3 | Email sending |

---

## 🎓 Key Features Summary

✅ **Automatic Scraping**: Fetches exams from government websites nightly  
✅ **AI-Powered Extraction**: OpenRouter AI extracts dates from exam portals  
✅ **User Subscriptions**: Email notifications for user-selected categories  
✅ **Email Alerts**: Automated 3-day-before-deadline reminders  
✅ **Custom Tracking**: Add any exam portal URL and system monitors it  
✅ **Beautiful UI**: Responsive Tailwind design  
✅ **Type-Safe**: Full TypeScript implementation  
✅ **Scalable**: Uses Supabase (scales to millions)  
✅ **Production-Ready**: Build succeeds with zero errors  

---

## 📝 Next Steps (Optional Enhancements)

1. **Deploy to Vercel** (free, takes 5 mins)
   - Push to GitHub → Connect repo to Vercel → Auto-deploys

2. **Add Authentication** (Supabase Auth)
   - Restrict portal access to logged-in users only

3. **Add Admin Dashboard** (already scaffolded)
   - Manually add/edit/delete exams
   - View subscription analytics

4. **Expand Categories**
   - Add more state PSCs (BPSC, JPSC, etc.)
   - Add banking, railway recruitment boards

5. **Improve Scraping**
   - Add error retry logic with exponential backoff
   - Store HTML snapshots for debugging

---

## 💬 Need Help?

Check the log files:
```bash
# Dev server logs
cat .next/dev/logs/next-development.log

# Build logs
npm run build 2>&1 | tee build.log
```

---

**🎉 Your exam notification system is ready to go!**

Open **http://localhost:3000** and start using it now.
