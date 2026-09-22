# 🚀 Production Hosting & Deployment Guide

This document outlines the **infrastructure requirements**, **security configurations**, and **step-by-step deployment methods** for hosting the **OTA Property Name Generator** centrally within an organization.

---

## 1. System Requirements & Specifications

### Hardware Sizing
| Resource | Minimum (1–5 Concurrent Users) | Recommended (Team-wide / Batch Processing) |
| :--- | :--- | :--- |
| **vCPU** | 1 Core | 2 Cores |
| **RAM** | 1 GB | 2 GB – 4 GB (recommended if Headless Chromium is used) |
| **Storage** | 10 GB SSD | 25 GB+ SSD (allows retention of batch Excel outputs and logs) |
| **Network** | 100 Mbps egress/ingress | Public outbound internet access to scrape listing URLs |

### Software & Runtime Dependencies
* **Node.js**: `v20.x LTS` or higher (ES Modules enabled).
* **Python**: `3.9` to `3.12` with `openpyxl` installed (required for multi-file Excel batch generation).
* **Headless Chromium / Chrome** *(Optional)*: Needed only if server-side DOM rendering is desired for JS-rendered OTA pages.
* **Process Manager / Container**: Docker, PM2, or systemd.

---

## 2. Environment Variables Configuration

Create a `.env` file in the root directory (or inject these environment variables in your cloud provider's secrets manager):

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `5178` | The HTTP port the server binds to. Cloud platforms like Render or AWS set this automatically. |
| `HOST` | String | `0.0.0.0` | Set to `0.0.0.0` in production so reverse proxies and Docker containers accept incoming traffic. |
| `NODE_ENV` | String | `production` | Enables production optimizations. |
| `ANTHROPIC_API_KEY` | String | *Optional* | If provided, activates Claude AI pass to refine property titles. Without this, the engine runs fully deterministically and offline with zero API costs. |
| `OTA_NAMER_MODEL` | String | `claude-opus-5` | Specifies Anthropic model name if API key is supplied. |
| `OTA_CHROME_PATH` | String | *Auto-detected* | Custom absolute path to Chromium binary if running in non-standard server path (e.g. `/usr/bin/chromium`). |

---

## 3. Recommended Hosting Options

Choose the deployment method that fits your organization's infrastructure:

```
┌────────────────────────────────────────────────────────┐
│               Enterprise Deployment Paths              │
├─────────────────────────┬──────────────────────────────┤
│ Method 1: Docker (ECS/  │ Best for modern cloud setups │
│           Cloud Run/k8s)│ Zero dependency mismatch     │
├─────────────────────────┼──────────────────────────────┤
│ Method 2: Linux VM (EC2/│ Full control, Nginx reverse  │
│           Droplet/Ubuntu│ proxy, Let's Encrypt SSL     │
├─────────────────────────┼──────────────────────────────┤
│ Method 3: Cloud PaaS    │ Fastest setup (5 minutes)    │
│           (Render/AWS)  │ Auto-builds directly from Git│
└─────────────────────────┴──────────────────────────────┘
```

---

### Option A: Docker / Container Deployment (Recommended)

This repository includes a production-ready `Dockerfile` and `docker-compose.yml`.

#### Step 1: Deploy with Docker Compose
On any cloud server with Docker installed:
```bash
# 1. Clone repository
git clone https://github.com/omeshwarsgit/stayvistanamegenratorusingai.git
cd stayvistanamegenratorusingai

# 2. Start container in background
docker compose up -d --build
```

#### Step 2: Verify Container Health
```bash
docker compose ps
curl http://localhost:5178/api/status
```

#### Step 3: Persistent Data Volumes
The `docker-compose.yml` mounts:
* `./data` → Keeps link index and run history intact across container rebuilds.
* `./output` → Stores generated automation Excel and ZIP files.
* `./uploads` → Stores temporary uploaded spreadsheets.

---

### Option B: Ubuntu Linux Server (AWS EC2 / DigitalOcean / On-Prem VM)

#### Step 1: Install Node.js 20 & Python 3
```bash
# Update package repositories
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Python 3, pip, and Chromium
sudo apt-get install -y python3 python3-pip chromium-browser nginx certbot python3-certbot-nginx
```

#### Step 2: Set Up the Application
```bash
# Clone the repository to /var/www
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/omeshwarsgit/stayvistanamegenratorusingai.git ota-namer
cd ota-namer

# Install dependencies
npm install --omit=dev
pip3 install openpyxl

# Create required writable directories
mkdir -p uploads output data
sudo chown -R $USER:$USER /var/www/ota-namer
```

#### Step 3: Configure PM2 Process Manager
PM2 ensures the server restarts automatically on crashes or system reboots:
```bash
sudo npm install -g pm2

# Start server with production environment
HOST=0.0.0.0 PORT=5178 pm2 start server.js --name "ota-namer"

# Set up PM2 to start on server boot
pm2 startup
pm2 save
```

#### Step 4: Configure Nginx as Reverse Proxy & SSL
Create an Nginx configuration file:
```bash
sudo nano /etc/nginx/sites-available/ota-namer
```

Paste the following block (replace `ota-namer.yourcompany.com` with your domain):
```nginx
server {
    listen 80;
    server_name ota-namer.yourcompany.com;

    # Allow large Excel batch file uploads (up to 100MB)
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:5178;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

Enable the site and obtain a free HTTPS certificate:
```bash
sudo ln -s /etc/nginx/sites-available/ota-namer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Generate SSL Certificate
sudo certbot --nginx -d ota-namer.yourcompany.com
```

---

### Option C: Managed Cloud PaaS (Render / Railway / AWS App Runner)

If you prefer not to manage virtual machines:

1. **Connect Repository**: Link `https://github.com/omeshwarsgit/stayvistanamegenratorusingai` to Render or Railway.
2. **Environment**: Select **Docker** or **Node.js**.
3. **Build Command**:
   ```bash
   npm install --omit=dev && pip3 install openpyxl
   ```
4. **Start Command**:
   ```bash
   node server.js
   ```
5. **Environment Variables**:
   * `HOST` = `0.0.0.0`
   * `NODE_ENV` = `production`
   * `PORT` = `5178` (or default assigned by platform)

---

## 4. Corporate Security & Access Control

To restrict this tool to internal company employees:

1. **Internal DNS / VPN**: Bind Nginx to listen only on your internal VPN interface (e.g. AWS VPC, Tailscale, or OpenVPN).
2. **Cloudflare Zero Trust / Google Cloud IAP**: Place the domain behind Cloudflare Access or Google Identity-Aware Proxy to require Google Workspace / Okta SSO login before accessing the dashboard.
3. **Nginx HTTP Basic Authentication**:
   ```bash
   sudo apt-get install apache2-utils
   sudo htpasswd -c /etc/nginx/.htpasswd employee_user
   ```
   Add inside the `server {}` block in Nginx:
   ```nginx
   auth_basic "Restricted Internal Tool";
   auth_basic_user_file /etc/nginx/.htpasswd;
   ```

---

## 5. Maintenance & Housekeeping

### Automated Cleanup of Temporary Uploads & Output ZIPs
Over time, user batch uploads in `uploads/` and generated ZIPs in `output/` take up disk space. Add a nightly cleanup cron job:

```bash
crontab -e
```

Add this line to remove files older than 14 days every night at 2:00 AM:
```cron
0 2 * * * find /var/www/ota-namer/uploads -type f -mtime +14 -delete
0 2 * * * find /var/www/ota-namer/output -name "*.zip" -type f -mtime +14 -delete
```

### Health Check Endpoint
The server provides a built-in health check endpoint:
```http
GET /api/status
```
Returns `HTTP 200` with JSON status:
```json
{
  "enabled": false,
  "render": { "available": true, "binary": "/usr/bin/chromium" },
  "capture": { "supported": true },
  "node": "v20.18.0"
}
```
This endpoint can be wired directly to AWS ALB Target Group health checks, Kubernetes liveness probes, or UptimeRobot.
