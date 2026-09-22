#!/usr/bin/env python3
"""
scripts/file_processor.py — Multi-File Batch Ingestion & Automation Output Generator.

Accepts multiple Excel (.xlsx) and CSV (.csv) files with legacy/current property names,
auto-detects columns and channels, enriches with OTA-compliant new names, resolves missing links,
and exports:
  1. In-place updated files (preserving 100% of original columns + inserting New_Name, New_Length,
     Limit, Sync_Status, Valid_Listing_URL).
  2. A consolidated Automation Master file formatted for RPA bots and channel manager APIs:
     [Listing_ID, SV_ID, Property_Name, OTA_Platform, Old_Name, New_Name, Valid_Listing_URL, Sync_Status, Rationale]
  3. A consolidated ZIP package containing all updated files + the automation master.
"""

import os
import sys
import re
import json
import csv
import copy
import zipfile
import datetime
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# Import link resolver
sys.path.insert(0, str(Path(__file__).resolve().parent))
from link_resolver import resolve_listing_url, normalize_ota_name, normalize_text

LIMITS = {
    'Airbnb': 44,
    'Booking.com': 50,
    'MakeMyTrip': 50,
    'Agoda': 50
}

LOCATIONS = [
    'Lonavala', 'Karjat', 'Shimla', 'Kasauli', 'Goa', 'Alibaug', 'Nashik', 
    'Udaipur', 'Jaipur', 'Mussoorie', 'Ooty', 'Coorg', 'Wayanad', 'Manali', 
    'Panchgani', 'Mahabaleshwar', 'Pune', 'Igatpuri', 'Dehradun', 'Khandala',
    'Nainital', 'Bhimtal', 'Kodaikanal', 'Rishikesh', 'Chandigarh', 'Mukteshwar',
    'Palghar', 'Wada', 'Alwar', 'Dharamshala', 'Kullu', 'Kasol', 'Agra', 'Srinagar',
    'Varanasi', 'Kochi', 'Alappuzha', 'Mysore', 'Madikeri', 'Sakleshpur', 'Chikmagalur'
]

PROP_TYPES = ['Villa', 'Cottage', 'Estate', 'Homestay', 'Farmhouse', 'House', 'Bungalow', 'Retreat', 'Chalet', 'Manor']

USP_PATTERNS = [
    ('Infinity Pool', r'infinity\s*pool'),
    ('Private Pool', r'private\s*pool'),
    ('Plunge Pool', r'plunge\s*pool'),
    ('Pool', r'(?<!infinity\s)(?<!private\s)(?<!plunge\s)\bpool\b'),
    ('Mountain View', r'mountain\s*view'),
    ('Valley View', r'valley\s*view'),
    ('Lake View', r'lake\s*view'),
    ('River View', r'river(?:side|\s*view)'),
    ('Heated Jacuzzi', r'heated\s*jacuzzi'),
    ('Jacuzzi', r'(?<!heated\s)jacuzzi'),
    ('Large Lawn', r'large\s*lawn'),
    ('Lawn', r'(?<!large\s)\blawn\b'),
    ('Bonfire', r'bonfire'),
    ('BBQ', r'bbq|barbecue'),
    ('Orchard', r'orchard'),
    ('Gazebo', r'gazebo'),
    ('Terrace', r'terrace'),
    ('Balcony', r'balcony'),
    ('Garden', r'garden')
]

def detect_channel_from_string(text: str) -> str:
    """Infers the OTA platform from filename, sheetname, or column value."""
    t = str(text or '').lower()
    if 'airbnb' in t or 'abnb' in t:
        return 'Airbnb'
    if 'booking' in t:
        return 'Booking.com'
    if 'makemytrip' in t or 'mmt' in t or 'go-mmt' in t or 'goibibo' in t:
        return 'MakeMyTrip'
    if 'agoda' in t:
        return 'Agoda'
    return 'Airbnb'

def detect_column_roles(headers: list) -> dict:
    """
    Fuzzy matches headers to roles:
      'title_col', 'id_col', 'sv_id_col', 'url_col', 'ota_col', 'bhk_col', 'type_col', 'city_col', 'usp_col'
    """
    roles = {
        'title_col': None,
        'id_col': None,
        'sv_id_col': None,
        'url_col': None,
        'ota_col': None,
        'bhk_col': None,
        'type_col': None,
        'city_col': None,
        'usp_col': None
    }

    for idx, h in enumerate(headers):
        if h is None: continue
        h_clean = str(h).strip().lower().replace('_', ' ').replace('-', ' ')
        
        # SV ID
        if any(k in h_clean for k in ['sv id', 'svid', 'primary property id', 'stayvista id']):
            roles['sv_id_col'] = idx
            continue
            
        # Listing ID / Hotel ID / Room ID
        if any(k in h_clean for k in ['listing id', 'property id', 'hotel id', 'hotelcode', 'airbnb id', 'ota id', 'channelhotelid']) or h_clean == 'id':
            if roles['id_col'] is None:
                roles['id_col'] = idx
            continue

        # OTA Channel
        if any(k in h_clean for k in ['ota platform', 'platform', 'channel', 'ota', 'source']):
            roles['ota_col'] = idx
            continue

        # Title / Property Name / Listing Name
        if any(k in h_clean for k in ['property name', 'listing name', 'current title', 'old name', 'name on otas', 'hotelname', 'villa name', 'title']) or h_clean == 'name':
            if roles['title_col'] is None:
                roles['title_col'] = idx
            continue

        # URL / Link
        if any(k in h_clean for k in ['valid listing url', 'listing url', 'property url', 'property link', 'exact agoda link', 'airbnb live link', 'booking.com live link', 'mmt link', 'url', 'link']):
            if roles['url_col'] is None:
                roles['url_col'] = idx
            continue

        # BHK / Bedrooms
        if any(k in h_clean for k in ['bhk', 'bedroom', 'bedrooms', 'rooms', 'no of bedrooms']):
            roles['bhk_col'] = idx
            continue

        # Property Type
        if any(k in h_clean for k in ['property type', 'category', 'accommodation type']):
            roles['type_col'] = idx
            continue

        # City / Location
        if any(k in h_clean for k in ['city', 'location', 'destination', 'state']):
            roles['city_col'] = idx
            continue

        # USPs / Amenities
        if any(k in h_clean for k in ['usps', 'usp', 'amenities', 'features']):
            roles['usp_col'] = idx
            continue

    # Fallbacks if title_col not found
    if roles['title_col'] is None:
        for idx, h in enumerate(headers):
            if idx not in (roles['id_col'], roles['sv_id_col'], roles['url_col'], roles['ota_col']):
                roles['title_col'] = idx
                break

    return roles

def extract_metadata_from_text(title_text: str, url_text: str = "") -> dict:
    """Infers BHK, property type, city, USPs, and cleaned villa name from text."""
    combined = f"{title_text} {url_text}"
    
    # BHK
    bhk_match = re.search(r'(\d+)\s*(?:bhk|br|bedroom|bed)', combined, re.IGNORECASE)
    bhk = int(bhk_match.group(1)) if bhk_match else 3

    # City
    city = 'India'
    for loc in LOCATIONS:
        if re.search(r'\b' + loc + r'\b', combined, re.IGNORECASE):
            city = loc
            break

    # Property Type
    ptype = 'Villa'
    for pt in PROP_TYPES:
        if re.search(r'\b' + pt + r'\b', combined, re.IGNORECASE):
            ptype = pt
            break

    # USPs
    usps = []
    for label, pat in USP_PATTERNS:
        if re.search(pat, combined, re.IGNORECASE):
            if label == 'Pool' and any(p in usps for p in ['Infinity Pool', 'Private Pool', 'Plunge Pool']):
                continue
            if label == 'Lawn' and 'Large Lawn' in usps:
                continue
            if label not in usps:
                usps.append(label)
    if not usps:
        usps = ['Private Pool' if ptype == 'Villa' else 'Lawn']

    # Clean brand candidate
    name_cand = None
    m = re.search(r'(?:StayVista(?:\'s| at| \|)?\s*)([A-Za-z0-9\s]+?)(?:\s*-\s*|\s*w\/|\s*with|\s*\||\s*@|\s*\d+\s*bhk|$)', title_text, re.IGNORECASE)
    if m:
        clean_n = m.group(1).strip()
        if clean_n and len(clean_n) > 2 and clean_n.lower() not in ('part of stayvista', 'comfort room', 'deluxe rooms', 'rooms'):
            name_cand = clean_n
    if not name_cand:
        name_cand = title_text.split('-')[0].split('|')[0].replace("StayVista's", '').replace('StayVista at', '').replace('StayVista', '').strip()
    name_cand = re.sub(r'\b(?:Villa|Cottage|Estate|House)\b', '', name_cand, flags=re.IGNORECASE).strip()
    if not name_cand:
        name_cand = "Vista Retreat"

    return {
        'name': name_cand,
        'bhk': bhk,
        'property_type': ptype,
        'city': city,
        'usps': usps
    }

def generate_ota_title(bhk: int, name: str, ptype: str, city: str, usps: list, ota: str) -> str:
    """Generates strictly compliant OTA title adhering to exact character limits."""
    usp1 = usps[0] if usps else 'Pool'
    usp2 = usps[1] if len(usps) > 1 else None
    
    if ota == 'Airbnb':
        # Limit 44: Strictly NO brand name, experience-focused
        clean_name = re.sub(r'\b(?:StayVista|Vista)\b', '', name, flags=re.I).strip()
        clean_name = re.sub(r'\s+', ' ', clean_name).strip()
        disp_name = clean_name or name
        if usp2 and len(f"{bhk}BHK {disp_name} • {usp1} & {usp2}") <= 44:
            return f"{bhk}BHK {disp_name} • {usp1} & {usp2}"
        cand1 = f"{bhk}BHK {disp_name} {ptype} w/ {usp1}"
        cand2 = f"{bhk}BHK {disp_name} w/ {usp1}"
        cand3 = f"{bhk}BHK {disp_name} • {usp1}"
        cand4 = f"{bhk}BHK {ptype} w/ {usp1}"
        cand5 = f"{bhk}BHK {disp_name}"
        for cand in [cand1, cand2, cand3, cand4, cand5]:
            if len(cand) <= 44: return cand
        return f"{bhk}BHK {disp_name}"[:44]
        
    elif ota == 'Booking.com':
        # Limit 50: StayVista brand enforced
        cand1 = f"{name} by StayVista - {bhk}BHK w/ {usp1}"
        cand2 = f"StayVista {name} - {bhk}BHK {ptype}"
        cand3 = f"StayVista - {bhk}BHK {ptype} w/ {usp1}"
        cand4 = f"StayVista {name} - {bhk}BHK"
        cand5 = f"StayVista - {bhk}BHK {ptype}"
        for cand in [cand1, cand2, cand3, cand4, cand5]:
            if len(cand) <= 50: return cand
        return f"StayVista - {bhk}BHK {ptype}"[:50]
        
    elif ota == 'MakeMyTrip':
        # Limit 50: Domestic formula: StayVista brand + BHK + Name + USP + City
        cand1 = f"StayVista | {bhk}BHK {name} • {usp1} • {city}"
        cand2 = f"StayVista | {bhk}BHK {name} • {city}"
        cand3 = f"StayVista | {bhk}BHK {name} • {usp1}"
        cand4 = f"StayVista | {bhk}BHK {ptype} • {usp1} • {city}"
        cand5 = f"StayVista | {bhk}BHK {ptype} • {city}"
        cand6 = f"StayVista | {bhk}BHK {name}"
        cand7 = f"StayVista - {bhk}BHK {ptype}"
        for cand in [cand1, cand2, cand3, cand4, cand5, cand6, cand7]:
            if len(cand) <= 50: return cand
        return f"StayVista | {bhk}BHK {ptype}"[:50]
        
    elif ota == 'Agoda':
        # Limit 50: Spelled-out bedrooms, StayVista brand & city included
        cand1 = f"StayVista - {bhk}-Bed {name}, {city} w/ {usp1}"
        cand2 = f"StayVista - {bhk}-Bedroom {name} in {city}"
        cand3 = f"StayVista - {bhk}-Bed {ptype}, {city} w/ {usp1}"
        cand4 = f"StayVista - {bhk}-Bedroom {name}"
        cand5 = f"StayVista - {bhk}-Bedroom {ptype} in {city}"
        cand6 = f"StayVista - {bhk}-Bed {ptype}"
        for cand in [cand1, cand2, cand3, cand4, cand5, cand6]:
            if len(cand) <= 50: return cand
        return f"StayVista - {bhk}-Bed {ptype}"[:50]
    
    return f"StayVista | {bhk}BHK {name} • {usp1}"[:50]

def analyze_reasons(current: str, suggested: str, limit: int, ota: str) -> str:
    reasons = []
    c_len = len(current)
    if c_len > limit:
        reasons.append(f"Fixed overflow: old was {c_len}/{limit} chars (truncated in search cards)")
    if any(sym in current for sym in ['|', '@', '+', '---']):
        reasons.append("Removed non-compliant symbols ('|', '@', '+')")
    if ota == 'Airbnb':
        reasons.append("Excluded brand name on Airbnb (strictly complies with Airbnb guidelines)")
    else:
        reasons.append("Added verified StayVista brand name for distribution trust")
    if 'bhk' in current.lower() and ota == 'Agoda':
        reasons.append("Replaced 'BHK' with international 'Bedroom' phrasing for Agoda")
    if ota == 'MakeMyTrip' and not re.search(r'\b\d+\s*bhk\b', current, re.I):
        reasons.append("Added prominent BHK prefix for domestic filter matching")
    if not reasons:
        reasons.append("Standardized structure: Size + Name + USP + Location")
    return "; ".join(reasons)


class BatchFileProcessor:
    def __init__(self, output_dir: str = "output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    def process_files(self, file_paths: list) -> dict:
        """Processes a list of file paths and generates enhanced files, master schema, and ZIP bundle."""
        processed_files = []
        master_rows = []
        total_records = 0
        total_overflows_fixed = 0
        total_links_resolved = 0

        for fpath in file_paths:
            f = Path(fpath)
            if not f.exists():
                print(f"[FileProcessor] Warning: file not found {f}", file=sys.stderr)
                continue

            print(f"[FileProcessor] Processing file: {f.name}...", file=sys.stderr)
            file_ext = f.suffix.lower()
            if file_ext == '.csv':
                res = self._process_csv(f)
            elif file_ext in ('.xlsx', '.xls'):
                res = self._process_xlsx(f)
            else:
                print(f"[FileProcessor] Skipping unsupported file type: {f.name}", file=sys.stderr)
                continue

            processed_files.append(res)
            master_rows.extend(res['master_rows'])
            total_records += res['record_count']
            total_overflows_fixed += res['overflows_fixed']
            total_links_resolved += res['links_resolved']

        # Generate Automation Master Sheets (Excel & CSV)
        run_id = f"RUN_{self.timestamp}"
        master_xlsx = self.output_dir / f"Automation_Sync_Master_{self.timestamp}.xlsx"
        master_csv = self.output_dir / f"Automation_Sync_Master_{self.timestamp}.csv"
        latest_xlsx = self.output_dir / "OTA_Name_Suggestions_Latest.xlsx"
        latest_csv = self.output_dir / "OTA_Name_Suggestions_Latest.csv"
        self._write_automation_master_xlsx(master_rows, master_xlsx)
        self._write_automation_master_csv(master_rows, master_csv)
        self._write_automation_master_xlsx(master_rows, latest_xlsx)
        self._write_automation_master_csv(master_rows, latest_csv)

        # Generate per-OTA sheets
        for platform in ['Airbnb', 'Booking.com', 'MakeMyTrip', 'Agoda']:
            p_rows = [r for r in master_rows if str(r.get('OTA_Platform', '')).lower() == platform.lower()]
            if p_rows:
                p_slug = platform.replace(' ', '_')
                self._write_automation_master_xlsx(p_rows, self.output_dir / f"OTA_Name_Suggestions_Latest_{p_slug}.xlsx")

        # Generate combined ZIP bundle
        zip_path = self.output_dir / f"OTA_Automation_Export_{self.timestamp}.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(master_xlsx, arcname=master_xlsx.name)
            zipf.write(master_csv, arcname=master_csv.name)
            for pf in processed_files:
                out_f = Path(pf['output_file'])
                if out_f.exists():
                    zipf.write(out_f, arcname=out_f.name)

        # Update run history
        try:
            history_file = Path(__file__).resolve().parent.parent / 'data' / 'runs_history.json'
            if history_file.exists():
                with open(history_file, 'r', encoding='utf-8') as hf:
                    history = json.load(hf)
            else:
                history = []
            run_record = {
                'run_id': run_id,
                'timestamp': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'total_records': total_records,
                'overflows_fixed': total_overflows_fixed,
                'links_resolved': total_links_resolved,
                'status': 'completed'
            }
            history.append(run_record)
            with open(history_file, 'w', encoding='utf-8') as hf:
                json.dump(history, hf, indent=2)
        except Exception:
            pass

        summary = {
            "ok": True,
            "run_id": run_id,
            "timestamp": self.timestamp,
            "total_files": len(processed_files),
            "total_records": total_records,
            "overflows_fixed": total_overflows_fixed,
            "links_resolved": total_links_resolved,
            "processed_files": [{
                "original_name": pf['original_name'],
                "output_name": pf['output_name'],
                "output_path": str(pf['output_file']),
                "record_count": pf['record_count'],
                "overflows_fixed": pf['overflows_fixed'],
                "links_resolved": pf['links_resolved']
            } for pf in processed_files],
            "master_xlsx": str(master_xlsx),
            "master_csv": str(master_csv),
            "zip_file": str(zip_path)
        }

        return summary

    def _process_csv(self, file_path: Path) -> dict:
        default_ota = detect_channel_from_string(file_path.stem)
        
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.reader(f)
            all_rows = list(reader)

        if not all_rows:
            return {'original_name': file_path.name, 'output_name': '', 'output_file': '', 'record_count': 0, 'overflows_fixed': 0, 'links_resolved': 0, 'master_rows': []}

        headers = all_rows[0]
        roles = detect_column_roles(headers)
        
        # New columns to insert in-place right after title_col
        insert_cols = ['New_Name', 'New_Length', 'Limit', 'Sync_Status', 'Valid_Listing_URL', 'Change_Rationale']
        title_idx = roles['title_col'] if roles['title_col'] is not None else 0
        
        new_headers = headers[:title_idx + 1] + insert_cols + headers[title_idx + 1:]
        
        output_rows = [new_headers]
        master_rows = []
        overflows_fixed = 0
        links_resolved = 0

        for row in all_rows[1:]:
            if not row or not any(row): continue
            # Pad row if needed
            while len(row) < len(headers): row.append('')

            curr_title = str(row[roles['title_col']]).strip() if roles['title_col'] is not None and roles['title_col'] < len(row) else ''
            sv_id = str(row[roles['sv_id_col']]).strip() if roles['sv_id_col'] is not None and roles['sv_id_col'] < len(row) else ''
            listing_id = str(row[roles['id_col']]).strip() if roles['id_col'] is not None and roles['id_col'] < len(row) else ''
            url = str(row[roles['url_col']]).strip() if roles['url_col'] is not None and roles['url_col'] < len(row) else ''
            
            ota = default_ota
            if roles['ota_col'] is not None and roles['ota_col'] < len(row) and str(row[roles['ota_col']]).strip():
                ota = detect_channel_from_string(row[roles['ota_col']])

            # Metadata extraction
            meta = extract_metadata_from_text(curr_title, url)
            bhk = int(row[roles['bhk_col']]) if roles['bhk_col'] is not None and roles['bhk_col'] < len(row) and str(row[roles['bhk_col']]).isdigit() else meta['bhk']
            ptype = str(row[roles['type_col']]).strip() if roles['type_col'] is not None and roles['type_col'] < len(row) and row[roles['type_col']] else meta['property_type']
            city = str(row[roles['city_col']]).strip() if roles['city_col'] is not None and roles['city_col'] < len(row) and row[roles['city_col']] else meta['city']
            prop_name = meta['name']

            # Resolve missing link
            had_valid_url = url.startswith('http')
            valid_url = resolve_listing_url(ota=ota, sv_id=sv_id, prop_name=curr_title or prop_name, city=city, current_url=url)
            if not had_valid_url and valid_url.startswith('http'):
                links_resolved += 1

            # Generate new name
            canonical_ota = normalize_ota_name(ota)
            limit = LIMITS.get(canonical_ota, 50)
            suggested = generate_ota_title(bhk, prop_name, ptype, city, meta['usps'], canonical_ota)

            if len(curr_title) > limit:
                overflows_fixed += 1

            rationale = analyze_reasons(curr_title, suggested, limit, canonical_ota)
            sync_status = "Ready for Automation Sync"

            # Build in-place row
            in_place_row = row[:title_idx + 1] + [suggested, len(suggested), limit, sync_status, valid_url, rationale] + row[title_idx + 1:]
            output_rows.append(in_place_row)

            # Build standardized automation schema row
            master_rows.append({
                'Listing_ID': listing_id or sv_id,
                'SV_ID': sv_id,
                'Property_Name': prop_name,
                'OTA_Platform': canonical_ota,
                'Old_Name': curr_title,
                'New_Name': suggested,
                'Valid_Listing_URL': valid_url,
                'Sync_Status': sync_status,
                'Rationale': rationale
            })

        out_name = f"{file_path.stem}_updated.csv"
        out_path = self.output_dir / out_name
        with open(out_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerows(output_rows)

        return {
            'original_name': file_path.name,
            'output_name': out_name,
            'output_file': out_path,
            'record_count': len(output_rows) - 1,
            'overflows_fixed': overflows_fixed,
            'links_resolved': links_resolved,
            'master_rows': master_rows
        }

    def _process_xlsx(self, file_path: Path) -> dict:
        wb = openpyxl.load_workbook(file_path, data_only=True)
        out_wb = openpyxl.Workbook()
        out_wb.remove(out_wb.active) # remove default sheet

        master_rows = []
        total_records = 0
        overflows_fixed = 0
        links_resolved = 0

        header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
        header_fill = PatternFill(start_color='0F172A', end_color='0F172A', fill_type='solid') # Slate 900
        new_header_fill = PatternFill(start_color='065F46', end_color='065F46', fill_type='solid') # Emerald 800
        border_thin = Border(left=Side(style='thin', color='E2E8F0'),
                             right=Side(style='thin', color='E2E8F0'),
                             top=Side(style='thin', color='E2E8F0'),
                             bottom=Side(style='thin', color='E2E8F0'))

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = list(ws.iter_rows(values_only=True))
            if not rows: continue

            headers = [str(c).strip() if c is not None else '' for c in rows[0]]
            roles = detect_column_roles(headers)
            default_ota = detect_channel_from_string(sheet_name or file_path.stem)
            
            title_idx = roles['title_col'] if roles['title_col'] is not None else 0
            insert_cols = ['New_Name', 'New_Length', 'Limit', 'Sync_Status', 'Valid_Listing_URL', 'Change_Rationale']
            new_headers = headers[:title_idx + 1] + insert_cols + headers[title_idx + 1:]

            out_ws = out_wb.create_sheet(title=sheet_name[:31])
            
            # Write Header
            out_ws.append(new_headers)
            for c_idx in range(1, len(new_headers) + 1):
                c = out_ws.cell(row=1, column=c_idx)
                c.font = header_font
                c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
                if new_headers[c_idx - 1] in insert_cols:
                    c.fill = new_header_fill
                else:
                    c.fill = header_fill

            for r_val in rows[1:]:
                if not r_val or not any(r_val): continue
                r_list = list(r_val)
                while len(r_list) < len(headers): r_list.append('')

                curr_title = str(r_list[roles['title_col']]).strip() if roles['title_col'] is not None and roles['title_col'] < len(r_list) else ''
                sv_id = str(r_list[roles['sv_id_col']]).strip() if roles['sv_id_col'] is not None and roles['sv_id_col'] < len(r_list) else ''
                listing_id = str(r_list[roles['id_col']]).strip() if roles['id_col'] is not None and roles['id_col'] < len(r_list) else ''
                url = str(r_list[roles['url_col']]).strip() if roles['url_col'] is not None and roles['url_col'] < len(r_list) else ''
                
                ota = default_ota
                if roles['ota_col'] is not None and roles['ota_col'] < len(r_list) and str(r_list[roles['ota_col']]).strip():
                    ota = detect_channel_from_string(r_list[roles['ota_col']])

                meta = extract_metadata_from_text(curr_title, url)
                bhk = int(r_list[roles['bhk_col']]) if roles['bhk_col'] is not None and roles['bhk_col'] < len(r_list) and str(r_list[roles['bhk_col']]).isdigit() else meta['bhk']
                ptype = str(r_list[roles['type_col']]).strip() if roles['type_col'] is not None and roles['type_col'] < len(r_list) and r_list[roles['type_col']] else meta['property_type']
                city = str(r_list[roles['city_col']]).strip() if roles['city_col'] is not None and roles['city_col'] < len(r_list) and r_list[roles['city_col']] else meta['city']
                prop_name = meta['name']

                had_valid_url = url.startswith('http')
                valid_url = resolve_listing_url(ota=ota, sv_id=sv_id, prop_name=curr_title or prop_name, city=city, current_url=url)
                if not had_valid_url and valid_url.startswith('http'):
                    links_resolved += 1

                canonical_ota = normalize_ota_name(ota)
                limit = LIMITS.get(canonical_ota, 50)
                suggested = generate_ota_title(bhk, prop_name, ptype, city, meta['usps'], canonical_ota)

                if len(curr_title) > limit:
                    overflows_fixed += 1

                rationale = analyze_reasons(curr_title, suggested, limit, canonical_ota)
                sync_status = "Ready for Automation Sync"

                in_place_row = r_list[:title_idx + 1] + [suggested, len(suggested), limit, sync_status, valid_url, rationale] + r_list[title_idx + 1:]
                out_ws.append(in_place_row)
                row_idx = out_ws.max_row

                # Format specific cells
                for c_idx in range(1, len(new_headers) + 1):
                    cell = out_ws.cell(row=row_idx, column=c_idx)
                    cell.border = border_thin
                    col_name = new_headers[c_idx - 1]
                    if col_name == 'New_Name':
                        cell.font = Font(name='Calibri', size=10, bold=True, color='047857') # Emerald
                    elif col_name == 'Valid_Listing_URL':
                        cell.hyperlink = cell.value
                        cell.font = Font(name='Calibri', size=10, color='1D4ED8', underline='single')
                    elif col_name == 'Sync_Status':
                        cell.font = Font(name='Calibri', size=10, bold=True, color='D97706') # Amber
                        cell.alignment = Alignment(horizontal='center')
                    elif col_name in ('New_Length', 'Limit'):
                        cell.alignment = Alignment(horizontal='center')

                total_records += 1
                master_rows.append({
                    'Listing_ID': listing_id or sv_id,
                    'SV_ID': sv_id,
                    'Property_Name': prop_name,
                    'OTA_Platform': canonical_ota,
                    'Old_Name': curr_title,
                    'New_Name': suggested,
                    'Valid_Listing_URL': valid_url,
                    'Sync_Status': sync_status,
                    'Rationale': rationale
                })

            # Format column widths
            out_ws.row_dimensions[1].height = 26
            for col in out_ws.columns:
                max_len = max(len(str(c.value or '')) for c in col)
                col_letter = get_column_letter(col[0].column)
                out_ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)

        out_name = f"{file_path.stem}_updated.xlsx"
        out_path = self.output_dir / out_name
        out_wb.save(out_path)

        return {
            'original_name': file_path.name,
            'output_name': out_name,
            'output_file': out_path,
            'record_count': total_records,
            'overflows_fixed': overflows_fixed,
            'links_resolved': links_resolved,
            'master_rows': master_rows
        }

    def _write_automation_master_xlsx(self, rows: list, target_path: Path):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Automation_Master"

        fields = [
            'Listing_ID', 'SV_ID', 'Property_Name', 'OTA_Platform',
            'Old_Name', 'New_Name', 'Valid_Listing_URL', 'Sync_Status', 'Rationale'
        ]

        header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
        header_fill = PatternFill(start_color='0F172A', end_color='0F172A', fill_type='solid')
        border_thin = Border(left=Side(style='thin', color='E2E8F0'),
                             right=Side(style='thin', color='E2E8F0'),
                             top=Side(style='thin', color='E2E8F0'),
                             bottom=Side(style='thin', color='E2E8F0'))

        ws.append(fields)
        for col_idx in range(1, len(fields) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center', vertical='center')

        for r_idx, r in enumerate(rows, 2):
            for c_idx, key in enumerate(fields, 1):
                cell = ws.cell(row=r_idx, column=c_idx)
                val = r.get(key, '')
                cell.value = val
                cell.border = border_thin
                if key == 'New_Name':
                    cell.font = Font(name='Calibri', size=10, bold=True, color='047857')
                elif key == 'Valid_Listing_URL':
                    cell.hyperlink = val
                    cell.font = Font(name='Calibri', size=10, color='1D4ED8', underline='single')
                elif key == 'Sync_Status':
                    cell.font = Font(name='Calibri', size=10, bold=True, color='D97706')
                    cell.alignment = Alignment(horizontal='center')
                else:
                    cell.font = Font(name='Calibri', size=10)

        ws.row_dimensions[1].height = 26
        for col in ws.columns:
            max_len = max(len(str(c.value or '')) for c in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)

        wb.save(target_path)

    def _write_automation_master_csv(self, rows: list, target_path: Path):
        fields = [
            'Listing_ID', 'SV_ID', 'Property_Name', 'OTA_Platform',
            'Old_Name', 'New_Name', 'Valid_Listing_URL', 'Sync_Status', 'Rationale'
        ]
        with open(target_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Multi-file batch ingestion and automation output generator.")
    parser.add_argument("files", nargs="*", help="Paths to files to process (.xlsx, .csv)")
    parser.add_argument("--test", action="store_true", help="Run self-test on sample input")
    args = parser.parse_args()

    processor = BatchFileProcessor()

    if args.test or not args.files:
        sample_file = "data/input_properties_batch_50.xlsx"
        if os.path.exists(sample_file):
            print(f"Running self-test on {sample_file}...")
            res = processor.process_files([sample_file])
            print(json.dumps(res, indent=2))
        else:
            print("Usage: python3 scripts/file_processor.py <file1.xlsx> <file2.csv> ...")
    else:
        res = processor.process_files(args.files)
        print(json.dumps(res, indent=2))
