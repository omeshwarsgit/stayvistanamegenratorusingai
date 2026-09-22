# 🌐 Hosting on Railway, Vercel, and Supabase

This guide explains how to deploy and run the **OTA Property Name Generator** across **Railway**, **Vercel**, and **Supabase**, including their respective roles, strengths, and exact setup steps.

---

## Architecture: How These 3 Services Work Together

| Service | Primary Role | Why Use It | Best Fit |
| :--- | :--- | :--- | :--- |
| **Railway** | **Full Application Host** | Runs the 24/7 web server, Node.js runtime, Python batch scripts, and background file exports with **no timeouts**. | ⭐ **Primary Host (Recommended)** |
| **Vercel** | **Serverless / Edge Host** | Fast global CDN for single-property analysis. | Quick lookups (Note serverless execution limits) |
| **Supabase** | **Database, Storage & Auth** | Cloud PostgreSQL database to save run history permanently, S3 storage buckets for batch files, and employee SSO login. | Cloud Backend & Storage Layer |

```
┌─────────────────────────────────────────────────────────────┐
│                  RECOMMENDED ARCHITECTURE                   │
│                                                             │
│   Web Dashboard & Batch Engine   ──▶   Railway (Container)  │
│   Database (Runs & Cache)        ──▶   Supabase (PostgreSQL)│
│   Batch Excel & ZIP Files        ──▶   Supabase (Storage S3)│
│   Employee Login (Google SSO)    ──▶   Supabase (Auth)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Hosting on Railway (Recommended — 2 Minutes Setup)

Railway is the best fit for this project because it runs both the Node.js server and Python batch processing scripts 24/7 with persistent storage and no function timeouts.

### Step-by-Step Setup:

1. **Go to Railway**: Visit [railway.app](https://railway.app) and sign in with GitHub.
2. **Create a New Project**:
   * Click **New Project** → Select **Deploy from GitHub repo**.
   * Choose `omeshwarsgit/stayvistanamegenratorusingai`.
3. **Automatic Build Detection**:
   * Railway will automatically detect the [railway.json](file:///Users/omeshwarshukla/Downloads/OTA%20Name%20Generator%20%202/railway.json) and [Dockerfile](file:///Users/omeshwarshukla/Downloads/OTA%20Name%20Generator%20%202/Dockerfile) in the repository.
   * It will build the container with Node.js 20, Python 3, and `openpyxl`.
4. **Attach Persistent Storage (Optional but Recommended)**:
   * In your Railway project dashboard, click on your service.
   * Go to the **Volumes** tab → Click **Add Volume**.
   * Set the mount path to `/app/output`.
   * (Add another volume for `/app/data` to persist run history across redeploys).
5. **Generate a Public Domain**:
   * Go to the **Settings** tab of your service.
   * Under **Networking** → Click **Generate Domain** (e.g. `ota-namer.up.railway.app`).
   * (Optional) Click **Custom Domain** to link your corporate domain (e.g. `ota-names.stayvista.com`).
6. **Set Environment Variables**:
   * Under the **Variables** tab, add:
     ```ini
     PORT=5178
     HOST=0.0.0.0
     NODE_ENV=production
     # Optional: ANTHROPIC_API_KEY=sk-ant-...
     ```
7. **Done!** Open your generated domain to access the live dashboard.

---

## 2. Hosting on Vercel

Vercel is a serverless platform. It works well for interactive web dashboards and individual listing URL analysis.

> [!IMPORTANT]
> **Vercel Limitations to Keep in Mind:**
> 1. **Execution Timeouts**: Serverless functions on Vercel have a default timeout (10s on Free, 60s on Pro). Single property analyses finish in ~1.5 seconds, but very large batch uploads (1,000+ properties) will exceed serverless timeouts.
> 2. **Ephemeral Disk**: Vercel has a read-only filesystem except for the temporary `/tmp` folder. Generated files must be streamed to the user or stored in Supabase Storage.

### Step-by-Step Setup:

1. **Log in to Vercel**: Visit [vercel.com](https://vercel.com) and log in with your GitHub account.
2. **Import Repository**:
   * Click **Add New...** → **Project**.
   * Select `omeshwarsgit/stayvistanamegenratorusingai` from your GitHub repos.
3. **Configure Project**:
   * **Framework Preset**: Other
   * **Root Directory**: `./`
   * Vercel will automatically detect the [vercel.json](file:///Users/omeshwarshukla/Downloads/OTA%20Name%20Generator%20%202/vercel.json) file created in this repository.
4. **Environment Variables**:
   * Expand **Environment Variables** and add:
     ```ini
     NODE_ENV=production
     # Optional: ANTHROPIC_API_KEY=sk-ant-...
     ```
5. **Deploy**:
   * Click **Deploy**. Vercel will build the project and provide a public URL (`https://your-project.vercel.app`).

---

## 3. Integrating with Supabase (Cloud Database, Storage & Auth)

Supabase is a **Backend-as-a-Service (BaaS)** powered by PostgreSQL. You do not deploy the web server to Supabase; instead, Supabase acts as your cloud database and file storage for the application running on Railway or Vercel.

### Step 1: Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and click **Start your project**.
2. Name your project (e.g. `ota-namer-db`), choose your database region, and set a database password.

### Step 2: Create Storage Buckets (For Excel & ZIP Files)
1. In the Supabase Dashboard sidebar, click **Storage**.
2. Click **New Bucket**:
   * Name: `ota-outputs` (Set to Public or Private depending on company policy).
   * Name: `ota-uploads` (For storing uploaded raw spreadsheets).
3. Any batch files generated by the system can be saved to this bucket so users can download them at any time.

### Step 3: Create Tables for Persistent History
In the Supabase Dashboard, click **SQL Editor** → **New Query**, paste the schema below, and click **Run**:

```sql
-- Table: Run History (replaces local runs_history.json)
CREATE TABLE IF NOT EXISTS run_history (
    id BIGSERIAL PRIMARY KEY,
    run_id VARCHAR(50) UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    total_properties INTEGER DEFAULT 0,
    successful INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    channels JSONB DEFAULT '[]',
    file_name VARCHAR(255),
    download_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: Verified Properties Cache (replaces master_links_index.json)
CREATE TABLE IF NOT EXISTS property_links_cache (
    id BIGSERIAL PRIMARY KEY,
    property_name VARCHAR(255) NOT NULL,
    stayvista_id VARCHAR(50),
    ota_platform VARCHAR(50),
    listing_url TEXT NOT NULL,
    last_verified TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_prop_platform UNIQUE (property_name, ota_platform)
);

-- Index for instant fuzzy and exact lookups
CREATE INDEX IF NOT EXISTS idx_prop_cache_name ON property_links_cache (property_name);
```

### Step 4: Add Supabase Credentials to Railway / Vercel
In Supabase, go to **Project Settings** → **API**. Copy:
* **Project URL**: `https://xyzcompany.supabase.co`
* **anon / service_role key**: `eyJhbGciOi...`

Add these into your Railway or Vercel Environment Variables:
```ini
SUPABASE_URL=https://xyzcompany.supabase.co
SUPABASE_KEY=eyJhbGciOi...
```

### Step 5: Enable Corporate Single Sign-On (SSO / Google Login)
1. In Supabase Dashboard, go to **Authentication** → **Providers**.
2. Enable **Google**.
3. Add your Google Cloud OAuth Client ID & Secret.
4. Restrict allowed email domains to `@stayvista.com` (or your company domain) under **Authentication** → **URL Configuration**.

---

## 4. Summary: Best Setup Recommendation

For the simplest, most powerful enterprise deployment:
1. **Deploy the app container on [Railway](https://railway.app)**: One-click GitHub connect, runs 24/7, handles all Python and Node.js tasks seamlessly.
2. **Connect [Supabase](https://supabase.com)**: For storing uploaded/generated Excel files in Storage buckets and recording run histories in PostgreSQL.
3. **Use Corporate Custom Domain**: Route `ota-names.stayvista.com` directly to Railway with free automatic SSL.
