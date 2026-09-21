import openpyxl, re, json, csv
from collections import defaultdict
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

EXCEL_PATH = '../Current OTA Property Name .xlsx'
INPUT_XLSX = 'data/input_properties_batch_50.xlsx'
INPUT_CSV = 'data/input_properties_batch_50.csv'

wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
sv_map = defaultdict(lambda: {'otas': {}})

for name in wb.sheetnames:
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    sheet_clean = name.strip()
    
    for r in rows[1:]:
        if not r or len(r) < 4: continue
        ota_id, title, sv_id, url = r[0], r[1], r[2], r[3]
        status = str(r[4]).strip() if len(r) > 4 and r[4] else ''
        
        if sv_id and str(sv_id).strip() not in ('Not Found', 'None', ''):
            try:
                sid = int(float(sv_id))
            except:
                sid = str(sv_id).strip()
            
            if status.lower() == 'live' and url and str(url).strip().startswith('http'):
                sv_map[sid]['otas'][sheet_clean] = {
                    'id': ota_id,
                    'title': str(title).strip() if title else '',
                    'url': str(url).strip() if url else ''
                }

all_4 = [sid for sid, d in sv_map.items() if len(d['otas']) == 4]
selected_sids = all_4[:50]

LOCATIONS = [
    'Lonavala', 'Karjat', 'Shimla', 'Kasauli', 'Goa', 'Alibaug', 'Nashik', 
    'Udaipur', 'Jaipur', 'Mussoorie', 'Ooty', 'Coorg', 'Wayanad', 'Manali', 
    'Panchgani', 'Mahabaleshwar', 'Pune', 'Igatpuri', 'Dehradun', 'Khandala',
    'Nainital', 'Bhimtal', 'Kodaikanal', 'Rishikesh', 'Chandigarh', 'Mukteshwar',
    'Palghar', 'Wada', 'Alwar', 'Dharamshala', 'Kullu', 'Kasol', 'Agra'
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
    ('Gazebo', r'gazebo')
]

def extract_attributes(sid, data):
    titles = [info['title'] for info in data['otas'].values()]
    urls = [info['url'] for info in data['otas'].values()]
    combined_text = " ".join(titles + urls)
    
    bhk_match = re.search(r'(\d+)\s*(?:bhk|br|bedroom)', combined_text, re.IGNORECASE)
    bhk = int(bhk_match.group(1)) if bhk_match else 3
    
    city = 'India'
    for loc in LOCATIONS:
        if re.search(r'\b' + loc + r'\b', combined_text, re.IGNORECASE):
            city = loc
            break
            
    ptype = 'Villa'
    for pt in PROP_TYPES:
        if re.search(r'\b' + pt + r'\b', combined_text, re.IGNORECASE):
            ptype = pt
            break
            
    usps = []
    for label, pat in USP_PATTERNS:
        if re.search(pat, combined_text, re.IGNORECASE):
            if label == 'Pool' and any(p in usps for p in ['Infinity Pool', 'Private Pool', 'Plunge Pool']):
                continue
            if label == 'Lawn' and 'Large Lawn' in usps:
                continue
            if label not in usps:
                usps.append(label)
    if not usps:
        usps = ['Private Pool' if ptype == 'Villa' else 'Lawn']

    name_cand = None
    for t in titles:
        m = re.search(r'(?:StayVista(?:\'s| at| \|)?\s*)([A-Za-z0-9\s]+?)(?:\s*-\s*|\s*w\/|\s*with|\s*\||\s*@|\s*\d+\s*bhk|$)', t, re.IGNORECASE)
        if m:
            clean_n = m.group(1).strip()
            if clean_n and len(clean_n) > 3 and clean_n.lower() not in ('part of stayvista', 'comfort room', 'deluxe rooms', 'rooms'):
                name_cand = clean_n
                break
    if not name_cand:
        name_cand = titles[0].split('-')[0].split('|')[0].replace("StayVista's", '').replace('StayVista at', '').replace('StayVista', '').strip()
    name_cand = re.sub(r'\b(?:Villa|Cottage|Estate|House)\b', '', name_cand, flags=re.IGNORECASE).strip()
    if not name_cand:
        name_cand = "Vista Retreat"

    return {
        'sv_id': sid,
        'brand_name': name_cand,
        'bhk': bhk,
        'city': city,
        'property_type': ptype,
        'usps': usps
    }

input_rows = []
for sid in selected_sids:
    data = sv_map[sid]
    attrs = extract_attributes(sid, data)
    for ota_name, ota_info in data['otas'].items():
        clean_ota = 'Booking.com' if 'booking' in ota_name.lower() else ('MakeMyTrip' if 'mmt' in ota_name.lower() else ota_name)
        input_rows.append({
            'SV_ID': sid,
            'Property_Name': attrs['brand_name'],
            'BHK': attrs['bhk'],
            'Property_Type': attrs['property_type'],
            'City': attrs['city'],
            'USPs': ", ".join(attrs['usps']),
            'OTA_Platform': clean_ota,
            'Current_Title': ota_info['title'],
            'Valid_Listing_URL': ota_info['url']
        })

# Write CSV
fieldnames = ['SV_ID', 'Property_Name', 'BHK', 'Property_Type', 'City', 'USPs', 'OTA_Platform', 'Current_Title', 'Valid_Listing_URL']
with open(INPUT_CSV, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(input_rows)

# Write XLSX with OpenPyXL
out_wb = openpyxl.Workbook()
ws = out_wb.active
ws.title = "Selected_50_Properties"

header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
header_fill = PatternFill(start_color='1E293B', end_color='1E293B', fill_type='solid')
border_thin = Border(left=Side(style='thin', color='CBD5E1'),
                     right=Side(style='thin', color='CBD5E1'),
                     top=Side(style='thin', color='CBD5E1'),
                     bottom=Side(style='thin', color='CBD5E1'))

ws.append(fieldnames)
for col_num in range(1, len(fieldnames) + 1):
    cell = ws.cell(row=1, column=col_num)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal='center', vertical='center')

for r_idx, row in enumerate(input_rows, 2):
    for c_idx, key in enumerate(fieldnames, 1):
        cell = ws.cell(row=r_idx, column=c_idx)
        val = row[key]
        if key == 'Valid_Listing_URL':
            cell.value = val
            cell.hyperlink = val
            cell.font = Font(name='Calibri', size=10, color='2563EB', underline='single')
        else:
            cell.value = val
            cell.font = Font(name='Calibri', size=10)
        cell.border = border_thin
        if key in ('SV_ID', 'BHK', 'Property_Type', 'City', 'OTA_Platform'):
            cell.alignment = Alignment(horizontal='center')

ws.row_dimensions[1].height = 24
for col in ws.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = get_column_letter(col[0].column)
    ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)

out_wb.save(INPUT_XLSX)
print(f"Created dedicated input files with real URL hyperlinks: {INPUT_XLSX} and {INPUT_CSV} ({len(input_rows)} rows).")
