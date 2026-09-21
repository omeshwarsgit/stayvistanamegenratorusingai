#!/usr/bin/env python3
import openpyxl, re, json, csv, os, sys, datetime
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else 'data/input_properties_batch_50.xlsx'
OUTPUT_DIR = 'output'
HISTORY_FILE = 'data/runs_history.json'

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs('data', exist_ok=True)

# Load run history
history = []
if os.path.exists(HISTORY_FILE):
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            history = json.load(f)
    except Exception:
        history = []

run_number = len(history) + 1
run_id = f"RUN_{run_number:03d}"
timestamp_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# Read input file (xlsx or csv)
records = []
if INPUT_FILE.endswith('.csv'):
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        records = list(reader)
else:
    in_wb = openpyxl.load_workbook(INPUT_FILE, data_only=True)
    ws = in_wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [str(c).strip() for c in rows[0]]
    for r in rows[1:]:
        if not r or not any(r): continue
        d = dict(zip(header, r))
        records.append(d)

LIMITS = {
    'Airbnb': 44,
    'Booking.com': 50,
    'MakeMyTrip': 50,
    'Agoda': 50
}

def generate_ota_title(bhk, name, ptype, city, usps, ota):
    usp1 = usps[0] if usps else 'Pool'
    usp2 = usps[1] if len(usps) > 1 else None
    
    if ota == 'Airbnb':
        # Limit 44, experience-focused, no city, no brand name (strict Airbnb compliance)
        clean_name = re.sub(r'\b(?:StayVista|Vista)\b', '', name, flags=re.I).strip()
        clean_name = re.sub(r'\s+', ' ', clean_name).strip()
        disp_name = clean_name or name
        if usp2 and len(f"{bhk}BHK {disp_name} • {usp1} & {usp2}") <= 44:
            return f"{bhk}BHK {disp_name} • {usp1} & {usp2}"
        cand1 = f"{bhk}BHK {disp_name} {ptype} w/ {usp1}"
        cand2 = f"{bhk}BHK {disp_name} w/ {usp1}"
        cand3 = f"{bhk}BHK {ptype} w/ {usp1}"
        cand4 = f"{bhk}BHK {ptype}"
        for cand in [cand1, cand2, cand3, cand4]:
            if len(cand) <= 44: return cand
        return cand3[:44]
        
    elif ota == 'Booking.com':
        # Limit 50, StayVista brand enforced
        cand1 = f"{name} by StayVista - {bhk}BHK w/ {usp1}"
        cand2 = f"StayVista {name} - {bhk}BHK {ptype}"
        cand3 = f"StayVista - {bhk}BHK {ptype} w/ {usp1}"
        cand4 = f"StayVista - {bhk}BHK {ptype}"
        for cand in [cand1, cand2, cand3, cand4]:
            if len(cand) <= 50: return cand
        return f"StayVista - {bhk}BHK {ptype}"[:50]
        
    elif ota == 'MakeMyTrip':
        # Limit 50, domestic formula: StayVista brand + BHK + USP + City
        cand1 = f"StayVista | {bhk}BHK {name} • {usp1} • {city}"
        cand2 = f"StayVista | {bhk}BHK {name} • {city}"
        cand3 = f"StayVista | {bhk}BHK {name} • {usp1}"
        cand4 = f"StayVista | {bhk}BHK {ptype} • {usp1} • {city}"
        cand5 = f"StayVista | {bhk}BHK {ptype} • {city}"
        cand6 = f"StayVista - {bhk}BHK {ptype}"
        for cand in [cand1, cand2, cand3, cand4, cand5, cand6]:
            if len(cand) <= 50: return cand
        return f"StayVista | {bhk}BHK {ptype}"[:50]
        
    elif ota == 'Agoda':
        # Limit 50, spelled-out bedrooms, StayVista brand & city included
        cand1 = f"StayVista - {bhk}-Bed {name}, {city} w/ {usp1}"
        cand2 = f"StayVista - {bhk}-Bedroom {name} in {city}"
        cand3 = f"StayVista - {bhk}-Bed {ptype}, {city} w/ {usp1}"
        cand4 = f"StayVista - {bhk}-Bedroom {ptype} in {city}"
        cand5 = f"StayVista - {bhk}-Bedroom {ptype}"
        for cand in [cand1, cand2, cand3, cand4, cand5]:
            if len(cand) <= 50: return cand
        return f"StayVista - {bhk}-Bed {ptype}"[:50]
    
    return f"StayVista | {bhk}BHK {name} • {usp1}"[:50]

def analyze_reasons(current, suggested, limit, ota):
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

output_rows = []
overflows_fixed = 0

for r in records:
    sv_id = r.get('SV_ID', '')
    prop_name = str(r.get('Property_Name', '')).strip()
    bhk = int(r.get('BHK', 3)) if str(r.get('BHK', '')).isdigit() else 3
    ptype = str(r.get('Property_Type', 'Villa')).strip()
    city = str(r.get('City', 'India')).strip()
    usps_str = str(r.get('USPs', '')).strip()
    usps = [u.strip() for u in usps_str.split(',') if u.strip()]
    ota = str(r.get('OTA_Platform', 'Airbnb')).strip()
    curr_title = str(r.get('Current_Title', '')).strip()
    url = str(r.get('Valid_Listing_URL', '')).strip()
    
    limit = LIMITS.get(ota, 50)
    suggested = generate_ota_title(bhk, prop_name, ptype, city, usps, ota)
    
    c_len = len(curr_title)
    s_len = len(suggested)
    if c_len > limit:
        overflows_fixed += 1
        len_status = f"Fixed Truncation ({c_len} -> {s_len} chars)"
    else:
        len_status = f"Within Limit ({s_len}/{limit} chars)"
        
    rationale = analyze_reasons(curr_title, suggested, limit, ota)
    
    output_rows.append({
        'Run_ID': run_id,
        'Timestamp': timestamp_str,
        'SV_ID': sv_id,
        'Property_Name': prop_name,
        'BHK': f"{bhk}BHK",
        'Property_Type': ptype,
        'City': city,
        'Primary_USP': usps[0] if usps else 'Pool',
        'OTA_Platform': ota,
        'Valid_Listing_URL': url,
        'Old_Name': curr_title,
        'Old_Length': c_len,
        'New_Name': suggested,
        'New_Length': s_len,
        'Limit': limit,
        'Length_Status': len_status,
        'Change_Rationale': rationale,
        'Sync_Status': 'Pending Backend Sync',
        'Backend_Updated_At': ''
    })

# Write Versioned Excel File and Latest Excel File
run_file_name = f"OTA_Name_Suggestions_{run_id}.xlsx"
run_file_path = os.path.join(OUTPUT_DIR, run_file_name)
latest_file_path = os.path.join(OUTPUT_DIR, 'OTA_Name_Suggestions_Latest.xlsx')

fieldnames = [
    'Run_ID', 'Timestamp', 'SV_ID', 'Property_Name', 'BHK', 'Property_Type', 'City',
    'Primary_USP', 'OTA_Platform', 'Valid_Listing_URL', 'Old_Name', 'Old_Length',
    'New_Name', 'New_Length', 'Limit', 'Length_Status', 'Change_Rationale',
    'Sync_Status', 'Backend_Updated_At'
]

def create_excel_workbook(rows, target_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Name_Suggestions"
    
    header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='0F172A', end_color='0F172A', fill_type='solid') # Slate 900
    border_thin = Border(left=Side(style='thin', color='E2E8F0'),
                         right=Side(style='thin', color='E2E8F0'),
                         top=Side(style='thin', color='E2E8F0'),
                         bottom=Side(style='thin', color='E2E8F0'))
    
    ws.append(fieldnames)
    for col_idx in range(1, len(fieldnames) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    
    for r_idx, row in enumerate(rows, 2):
        for c_idx, key in enumerate(fieldnames, 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            val = row[key]
            if key == 'Valid_Listing_URL':
                cell.value = val
                cell.hyperlink = val
                cell.font = Font(name='Calibri', size=10, color='1D4ED8', underline='single')
            elif key == 'New_Name':
                cell.value = val
                cell.font = Font(name='Calibri', size=10, bold=True, color='047857') # Emerald bold
            elif key == 'Old_Name':
                cell.value = val
                cell.font = Font(name='Calibri', size=10, color='475569')
            elif key == 'Sync_Status':
                cell.value = val
                cell.font = Font(name='Calibri', size=10, bold=True, color='D97706') # Amber
                cell.alignment = Alignment(horizontal='center')
            else:
                cell.value = val
                cell.font = Font(name='Calibri', size=10)
                
            cell.border = border_thin
            if key in ('Run_ID', 'Timestamp', 'SV_ID', 'BHK', 'Property_Type', 'City', 'OTA_Platform', 'Old_Length', 'New_Length', 'Limit', 'Length_Status'):
                cell.alignment = Alignment(horizontal='center')
                
    ws.row_dimensions[1].height = 28
    for col in ws.columns:
        max_len = max(len(str(c.value or '')) for c in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)
        
    wb.save(target_path)

create_excel_workbook(output_rows, run_file_path)
create_excel_workbook(output_rows, latest_file_path)

# Generate individual OTA workbooks for selective download
for platform in ['Airbnb', 'Booking.com', 'MakeMyTrip', 'Agoda']:
    platform_rows = [r for r in output_rows if r['OTA_Platform'].lower() == platform.lower()]
    if platform_rows:
        plat_slug = platform.replace(' ', '_')
        create_excel_workbook(platform_rows, os.path.join(OUTPUT_DIR, f"OTA_Name_Suggestions_Latest_{plat_slug}.xlsx"))
        create_excel_workbook(platform_rows, os.path.join(OUTPUT_DIR, f"OTA_Name_Suggestions_{run_id}_{plat_slug}.xlsx"))

# Also save CSV for quick text access
csv_path = os.path.join(OUTPUT_DIR, f"OTA_Name_Suggestions_{run_id}.csv")
latest_csv_path = os.path.join(OUTPUT_DIR, 'OTA_Name_Suggestions_Latest.csv')
with open(csv_path, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(output_rows)
with open(latest_csv_path, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(output_rows)

# Update run history
run_record = {
    'run_id': run_id,
    'timestamp': timestamp_str,
    'input_file': INPUT_FILE,
    'output_file': run_file_path,
    'latest_file': latest_file_path,
    'total_records': len(output_rows),
    'overflows_fixed': overflows_fixed,
    'status': 'completed'
}
history.append(run_record)
with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
    json.dump(history, f, indent=2)

print(json.dumps(run_record))
