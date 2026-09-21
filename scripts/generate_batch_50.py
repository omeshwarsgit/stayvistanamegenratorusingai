import openpyxl, re, json, csv
from collections import defaultdict

EXCEL_PATH = '../Current OTA Property Name .xlsx'
JSON_OUT = 'data/properties_batch_50.json'
CSV_OUT = 'data/properties_batch_50.csv'

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

# Prioritize properties that exist on all 4 OTAs
all_4 = [sid for sid, d in sv_map.items() if len(d['otas']) == 4]
print(f"Total properties live on all 4 OTAs: {len(all_4)}")

LOCATIONS = [
    'Lonavala', 'Karjat', 'Shimla', 'Kasauli', 'Goa', 'Alibaug', 'Nashik', 
    'Udaipur', 'Jaipur', 'Mussoorie', 'Ooty', 'Coorg', 'Wayanad', 'Manali', 
    'Panchgani', 'Mahabaleshwar', 'Pune', 'Igatpuri', 'Dehradun', 'Khandala',
    'Nainital', 'Bhimtal', 'Kodaikanal', 'Rishikesh', 'Chandigarh', 'Mukteshwar',
    'Palghar', 'Wada', 'Alwar', 'Dharamshala', 'Kullu', 'Kasol', 'Agra'
]

PROP_TYPES = [
    'Villa', 'Cottage', 'Estate', 'Homestay', 'Farmhouse', 'House', 'Bungalow', 'Retreat', 'Chalet', 'Manor'
]

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
    
    # BHK
    bhk_match = re.search(r'(\d+)\s*(?:bhk|br|bedroom)', combined_text, re.IGNORECASE)
    bhk = int(bhk_match.group(1)) if bhk_match else 3 # default sensible 3BHK if unstated
    
    # Location
    city = 'India'
    for loc in LOCATIONS:
        if re.search(r'\b' + loc + r'\b', combined_text, re.IGNORECASE):
            city = loc
            break
            
    # Property Type
    ptype = 'Villa'
    for pt in PROP_TYPES:
        if re.search(r'\b' + pt + r'\b', combined_text, re.IGNORECASE):
            ptype = pt
            break
            
    # USPs
    usps = []
    for label, pat in USP_PATTERNS:
        if re.search(pat, combined_text, re.IGNORECASE):
            if label == 'Pool' and ('Infinity Pool' in usps or 'Private Pool' in usps or 'Plunge Pool' in usps):
                continue
            if label == 'Lawn' and 'Large Lawn' in usps:
                continue
            if label == 'Jacuzzi' and 'Heated Jacuzzi' in usps:
                continue
            if label not in usps:
                usps.append(label)
    if not usps:
        usps = ['Private Pool' if ptype == 'Villa' else 'Lawn']

    # Clean Name
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
    # Remove redundant property type from name if already in name
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

def generate_ota_titles(attrs):
    name = attrs['brand_name']
    bhk = attrs['bhk']
    city = attrs['city']
    ptype = attrs['property_type']
    usp1 = attrs['usps'][0] if attrs['usps'] else 'Pool'
    usp2 = attrs['usps'][1] if len(attrs['usps']) > 1 else None
    
    # 1. Airbnb (limit 44 chars, experience-focused, no city, no spam symbols)
    # Format: "{bhk}BHK {name} w/ {usp1}" or "{bhk}BHK {ptype} • {usp1} & {usp2}"
    cand1 = f"{bhk}BHK {name} {ptype} w/ {usp1}"
    cand2 = f"{bhk}BHK {name} w/ {usp1}"
    cand3 = f"{bhk}BHK {ptype} w/ {usp1}"
    if usp2 and len(f"{bhk}BHK {name} • {usp1} & {usp2}") <= 44:
        airbnb_title = f"{bhk}BHK {name} • {usp1} & {usp2}"
    elif len(cand1) <= 44:
        airbnb_title = cand1
    elif len(cand2) <= 44:
        airbnb_title = cand2
    else:
        airbnb_title = cand3[:44]
        
    # 2. Booking.com (limit 50 chars, house name leads)
    # Format: "{name} {ptype} by StayVista - {bhk}BHK w/ {usp1}"
    cand_b1 = f"{name} {ptype} by StayVista - {bhk}BHK w/ {usp1}"
    cand_b2 = f"{name} {ptype} - {bhk}BHK with {usp1}"
    cand_b3 = f"{name} by StayVista - {bhk}BHK {usp1}"
    if len(cand_b1) <= 50:
        booking_title = cand_b1
    elif len(cand_b2) <= 50:
        booking_title = cand_b2
    else:
        booking_title = cand_b3[:50]
        
    # 3. MakeMyTrip (limit 50 chars, BHK first + USP + City for domestic search)
    # Format: "{bhk}BHK {name} {ptype} • {usp1} • {city}"
    cand_m1 = f"{bhk}BHK {name} {ptype} • {usp1} • {city}"
    cand_m2 = f"{bhk}BHK {name} • {usp1} • {city}"
    cand_m3 = f"{bhk}BHK {ptype} • {usp1} • {city}"
    if len(cand_m1) <= 50:
        mmt_title = cand_m1
    elif len(cand_m2) <= 50:
        mmt_title = cand_m2
    else:
        mmt_title = cand_m3[:50]
        
    # 4. Agoda (limit 50 chars, spelled-out bedrooms, name & city included)
    # Format: "{bhk}-Bedroom {name} {ptype} in {city} w/ {usp1}"
    cand_a1 = f"{bhk}-Bedroom {name} {ptype}, {city} w/ {usp1}"
    cand_a2 = f"{bhk}-Bedroom {name} {ptype} in {city}"
    cand_a3 = f"{bhk}-Bedroom {ptype} in {city} w/ {usp1}"
    if len(cand_a1) <= 50:
        agoda_title = cand_a1
    elif len(cand_a2) <= 50:
        agoda_title = cand_a2
    else:
        agoda_title = cand_a3[:50]
        
    return {
        'Airbnb': airbnb_title,
        'Booking.com': booking_title,
        'MakeMyTrip': mmt_title,
        'Agoda': agoda_title
    }

def analyze_diff(current, suggested, limit, ota):
    reasons = []
    c_len = len(current)
    s_len = len(suggested)
    
    if c_len > limit:
        reasons.append(f"Fixed length overflow: was {c_len}/{limit} chars (truncated in search cards)")
    if any(sym in current for sym in ['|', '@', '+', '---']):
        reasons.append("Removed non-compliant/cluttered characters ('|', '@', '+')")
    if 'stayvista' in current.lower() and ota == 'Airbnb':
        reasons.append("Removed redundant brand name on Airbnb (saves space for top USP)")
    if 'bhk' in current.lower() and ota == 'Agoda':
        reasons.append("Replaced 'BHK' with international 'Bedroom' phrasing for Agoda")
    if ota == 'MakeMyTrip' and not re.search(r'\b\d+\s*bhk\b', current, re.I):
        reasons.append("Added prominent BHK prefix for domestic filter matching")
    if not reasons:
        reasons.append("Structured into clean standard formula: Size + Name + USP + Location")
        
    return "; ".join(reasons)

# Select 50 properties
selected_sids = all_4[:50]

batch_records = []
csv_rows = []

LIMITS = {
    'Airbnb': 44,
    'Booking.com': 50,
    'MakeMyTrip': 50,
    'Agoda': 50
}

for sid in selected_sids:
    data = sv_map[sid]
    attrs = extract_attributes(sid, data)
    suggested_titles = generate_ota_titles(attrs)
    
    prop_record = {
        'sv_id': sid,
        'brand_name': attrs['brand_name'],
        'bhk': attrs['bhk'],
        'property_type': attrs['property_type'],
        'city': attrs['city'],
        'usps': attrs['usps'],
        'otas': {}
    }
    
    for ota_name, ota_info in data['otas'].items():
        # Clean mapping key
        clean_key = 'Booking.com' if 'booking' in ota_name.lower() else ('MakeMyTrip' if 'mmt' in ota_name.lower() else ota_name)
        curr_title = ota_info['title']
        sugg_title = suggested_titles.get(clean_key, "")
        limit = LIMITS.get(clean_key, 50)
        
        rationale = analyze_diff(curr_title, sugg_title, limit, clean_key)
        
        ota_entry = {
            'listing_id': ota_info['id'],
            'listing_url': ota_info['url'],
            'current_title': curr_title,
            'current_length': len(curr_title),
            'suggested_title': sugg_title,
            'suggested_length': len(sugg_title),
            'limit': limit,
            'status': 'ready_to_sync',
            'change_rationale': rationale
        }
        prop_record['otas'][clean_key] = ota_entry
        
        csv_rows.append({
            'SV_ID': sid,
            'Property_Name': attrs['brand_name'],
            'BHK': attrs['bhk'],
            'Property_Type': attrs['property_type'],
            'City': attrs['city'],
            'Primary_USP': attrs['usps'][0] if attrs['usps'] else '',
            'OTA_Platform': clean_key,
            'Current_Title': curr_title,
            'Current_Len': len(curr_title),
            'Suggested_Title': sugg_title,
            'Suggested_Len': len(sugg_title),
            'Limit': limit,
            'Status': 'ready_to_sync',
            'Change_Rationale': rationale,
            'Listing_URL': ota_info['url']
        })
        
    batch_records.append(prop_record)

# Save JSON
with open(JSON_OUT, 'w', encoding='utf-8') as f:
    json.dump(batch_records, f, indent=2)

# Save CSV
fieldnames = [
    'SV_ID', 'Property_Name', 'BHK', 'Property_Type', 'City', 'Primary_USP',
    'OTA_Platform', 'Current_Title', 'Current_Len', 'Suggested_Title', 'Suggested_Len',
    'Limit', 'Status', 'Change_Rationale', 'Listing_URL'
]
with open(CSV_OUT, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(csv_rows)

print(f"Generated {len(batch_records)} property records ({len(csv_rows)} OTA rows).")
print(f"Saved to {JSON_OUT} and {CSV_OUT}.")
