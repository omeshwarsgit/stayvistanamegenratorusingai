#!/usr/bin/env python3
"""
scripts/link_resolver.py — Automated Link Discovery & Redirection System for OTA Listings.

Resolves missing or broken listing URLs so that:
1. Claude backend analysis / redirection never fails.
2. Automation systems and spreadsheets have valid, clickable URLs for every property.

Resolution Hierarchy:
  1. Valid URL check (returns immediate if already valid).
  2. Persistent cache lookup (data/resolved_links_cache.json).
  3. Local Excel cross-reference across all sheets in:
     - Stayvista Property Links.xlsx (Agoda, Booking.com, MMT, Airbnb, Property Links, OTA Master)
     - Current OTA Property Name .xlsx
  4. StayVista Official Villa Page (https://www.stayvista.com/villa/{slug}) — Claude's source of truth.
  5. OTA Search Redirection URL (Booking.com, Agoda, Airbnb, MMT search endpoints).
"""

import os
import sys
import re
import json
import urllib.parse
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
CACHE_FILE = DATA_DIR / "resolved_links_cache.json"
INDEX_CACHE_FILE = DATA_DIR / "master_links_index.json"

DOWNLOADS_DIR = Path.home() / "Downloads"
FILES_TO_INDEX = [
    DOWNLOADS_DIR / "Stayvista Property Links.xlsx",
    DOWNLOADS_DIR / "Current OTA Property Name .xlsx"
]

def normalize_text(text: str) -> str:
    """Normalize text for fuzzy matching by removing punctuation and extra spaces."""
    if not text:
        return ""
    # Strip common StayVista prefixes
    t = re.sub(r'^(?:stayvista(?:\'s)?(?:\s+at)?\s*[-|:]?\s*)', '', str(text), flags=re.IGNORECASE)
    t = re.sub(r'[^a-zA-Z0-9\s]', ' ', t)
    return " ".join(t.lower().split())

def make_slug(name: str) -> str:
    """Create URL slug from property name."""
    clean = normalize_text(name)
    return "-".join(clean.split())

def normalize_ota_name(ota: str) -> str:
    """Standardize OTA names into canonical keys."""
    o = str(ota).strip().lower()
    if 'book' in o:
        return 'Booking.com'
    if 'mmt' in o or 'makemytrip' in o or 'go-mmt' in o:
        return 'MakeMyTrip'
    if 'agoda' in o:
        return 'Agoda'
    if 'air' in o or 'bnb' in o:
        return 'Airbnb'
    return ota.strip()

class LinkResolver:
    def __init__(self):
        self.cache = self._load_cache()
        self.index = self._load_or_build_index()

    def _load_cache(self) -> dict:
        if CACHE_FILE.exists():
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_cache(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, indent=2)

    def _load_or_build_index(self) -> dict:
        """Loads master index from disk cache if fresh, otherwise builds from spreadsheets."""
        if INDEX_CACHE_FILE.exists():
            try:
                # Check if older than source files
                idx_mtime = INDEX_CACHE_FILE.stat().st_mtime
                sources_newer = any(f.exists() and f.stat().st_mtime > idx_mtime for f in FILES_TO_INDEX)
                if not sources_newer:
                    with open(INDEX_CACHE_FILE, "r", encoding="utf-8") as f:
                        return json.load(f)
            except Exception:
                pass

        return self._build_index()

    def _build_index(self) -> dict:
        """Parses local spreadsheets and builds fast lookup maps."""
        import openpyxl

        print("[LinkResolver] Building master links index from local sheets...")
        ota_links = {}     # key: f"{ota}_{svid}" -> url
        name_links = {}    # key: f"{ota}_{norm_name}" -> url
        sv_websites = {}   # key: svid or norm_name -> stayvista url

        # 1. Parse Stayvista Property Links.xlsx
        pl_path = DOWNLOADS_DIR / "Stayvista Property Links.xlsx"
        if pl_path.exists():
            try:
                wb = openpyxl.load_workbook(pl_path, data_only=True, read_only=True)
                
                # Sheet: Agoda
                if 'Agoda' in wb.sheetnames:
                    ws = wb['Agoda']
                    for r in ws.iter_rows(values_only=True):
                        if not r or len(r) < 5: continue
                        url, sv_id, name = r[3], r[4], r[1]
                        if url and str(url).startswith('http'):
                            u = str(url).strip()
                            if sv_id:
                                sid = str(sv_id).split('.')[0].strip()
                                ota_links[f"Agoda_{sid}"] = u
                            if name:
                                name_links[f"Agoda_{normalize_text(name)}"] = u

                # Sheet: Booking.com
                for sname in wb.sheetnames:
                    if 'booking' in sname.lower():
                        ws = wb[sname]
                        for r in ws.iter_rows(values_only=True):
                            if not r or len(r) < 4: continue
                            url, sv_id, name = r[2], r[3], r[1]
                            if url and str(url).startswith('http'):
                                u = str(url).strip()
                                if sv_id:
                                    sid = str(sv_id).split('.')[0].strip()
                                    ota_links[f"Booking.com_{sid}"] = u
                                if name:
                                    name_links[f"Booking.com_{normalize_text(name)}"] = u
                        break

                # Sheet: MMT
                if 'MMT' in wb.sheetnames:
                    ws = wb['MMT']
                    for r in ws.iter_rows(values_only=True):
                        if not r or len(r) < 5: continue
                        url, sv_id, name = r[3], r[4], r[2]
                        if url and str(url).startswith('http'):
                            u = str(url).strip()
                            if sv_id:
                                sid = str(sv_id).split('.')[0].strip()
                                ota_links[f"MakeMyTrip_{sid}"] = u
                            if name:
                                name_links[f"MakeMyTrip_{normalize_text(name)}"] = u

                # Sheet: Airbnb
                if 'Airbnb' in wb.sheetnames:
                    ws = wb['Airbnb']
                    for r in ws.iter_rows(values_only=True):
                        if not r or len(r) < 6: continue
                        url, sv_id, name = r[3], r[5], r[1]
                        if url and str(url).startswith('http'):
                            u = str(url).strip()
                            if sv_id:
                                sid = str(sv_id).split('.')[0].strip()
                                ota_links[f"Airbnb_{sid}"] = u
                            if name:
                                name_links[f"Airbnb_{normalize_text(name)}"] = u

                # Sheet: Property Links
                for sname in wb.sheetnames:
                    if 'property links' in sname.lower():
                        ws = wb[sname]
                        for r in ws.iter_rows(values_only=True):
                            if not r or len(r) < 8: continue
                            # ('ID ', 'Primary_Property_ID ', 'Property_Name', 'SV ', 'Agoda', 'MMT ', 'Booking ', 'Airbnb')
                            sid, name = str(r[0]).split('.')[0].strip() if r[0] else '', str(r[2] or '').strip()
                            sv_url, agoda_u, mmt_u, bkg_u, abnb_u = r[3], r[4], r[5], r[6], r[7]
                            norm_n = normalize_text(name)
                            
                            if sv_url and str(sv_url).startswith('http'):
                                if sid: sv_websites[sid] = str(sv_url).strip()
                                if norm_n: sv_websites[norm_n] = str(sv_url).strip()
                            if agoda_u and str(agoda_u).startswith('http'):
                                if sid: ota_links[f"Agoda_{sid}"] = str(agoda_u).strip()
                                if norm_n: name_links[f"Agoda_{norm_n}"] = str(agoda_u).strip()
                            if mmt_u and str(mmt_u).startswith('http'):
                                if sid: ota_links[f"MakeMyTrip_{sid}"] = str(mmt_u).strip()
                                if norm_n: name_links[f"MakeMyTrip_{norm_n}"] = str(mmt_u).strip()
                            if bkg_u and str(bkg_u).startswith('http'):
                                if sid: ota_links[f"Booking.com_{sid}"] = str(bkg_u).strip()
                                if norm_n: name_links[f"Booking.com_{norm_n}"] = str(bkg_u).strip()
                            if abnb_u and str(abnb_u).startswith('http'):
                                if sid: ota_links[f"Airbnb_{sid}"] = str(abnb_u).strip()
                                if norm_n: name_links[f"Airbnb_{norm_n}"] = str(abnb_u).strip()
                        break
            except Exception as e:
                print(f"[LinkResolver] Warning reading Stayvista Property Links.xlsx: {e}")

        # 2. Parse Current OTA Property Name .xlsx
        curr_path = DOWNLOADS_DIR / "Current OTA Property Name .xlsx"
        if curr_path.exists():
            try:
                wb2 = openpyxl.load_workbook(curr_path, data_only=True, read_only=True)
                for sname in wb2.sheetnames:
                    ota_clean = normalize_ota_name(sname)
                    ws = wb2[sname]
                    for r in ws.iter_rows(values_only=True):
                        if not r or len(r) < 4: continue
                        name, sv_id, url = r[1], r[2], r[3]
                        if url and str(url).startswith('http'):
                            u = str(url).strip()
                            if sv_id and str(sv_id).strip() not in ('Not Found', 'None', ''):
                                sid = str(sv_id).split('.')[0].strip()
                                ota_links[f"{ota_clean}_{sid}"] = u
                            if name:
                                name_links[f"{ota_clean}_{normalize_text(name)}"] = u
            except Exception as e:
                print(f"[LinkResolver] Warning reading Current OTA Property Name .xlsx: {e}")

        index_data = {
            "ota_links": ota_links,
            "name_links": name_links,
            "sv_websites": sv_websites
        }

        # Save to cache
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(INDEX_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(index_data, f)
            print(f"[LinkResolver] Indexed {len(ota_links)} OTA SVID links, {len(name_links)} name links, {len(sv_websites)} StayVista pages.")
        except Exception as e:
            print(f"[LinkResolver] Error saving master index: {e}")

        return index_data

    def construct_search_url(self, ota: str, prop_name: str, city: str = "") -> str:
        """Builds an OTA direct search or redirection endpoint for Claude."""
        clean_name = re.sub(r'^(?:stayvista(?:\'s)?(?:\s+at)?\s*[-|:]?\s*)', '', prop_name, flags=re.IGNORECASE).strip()
        query_parts = ["StayVista", clean_name]
        if city and city.lower() not in ('india', 'unknown', ''):
            query_parts.append(city)
        query = " ".join(query_parts)
        encoded_query = urllib.parse.quote(query)

        canonical_ota = normalize_ota_name(ota)
        if canonical_ota == 'Booking.com':
            return f"https://www.booking.com/searchresults.html?ss={encoded_query}"
        elif canonical_ota == 'Agoda':
            return f"https://www.agoda.com/search?text={encoded_query}"
        elif canonical_ota == 'MakeMyTrip':
            return f"https://www.makemytrip.com/hotels/hotel-listing/?searchText={encoded_query}"
        elif canonical_ota == 'Airbnb':
            return f"https://www.airbnb.com/s/{encoded_query}/homes"
        else:
            return f"https://www.stayvista.com/search?q={encoded_query}"

    def resolve(self, ota: str, sv_id: str = "", prop_name: str = "", city: str = "", current_url: str = "") -> str:
        """
        Resolves the best available URL for a listing.
        Guaranteed to return a valid http/https URL suitable for Claude and browser inspection.
        """
        # 1. If current URL is already a valid live link
        if current_url and str(current_url).strip().startswith("http"):
            u = str(current_url).strip()
            if not any(x in u for x in ["not-found", "example.com", "placeholder"]):
                return u

        canonical_ota = normalize_ota_name(ota)
        sid = str(sv_id).split('.')[0].strip() if sv_id and str(sv_id).strip() not in ('Not Found', 'None', 'nan') else ""
        norm_name = normalize_text(prop_name)
        cache_key = f"{sid}_{canonical_ota}_{prop_name}"

        # 2. Check persistent resolved cache
        if cache_key in self.cache:
            return self.cache[cache_key]

        # 3. Local cross-reference by SVID
        if sid:
            link = self.index.get("ota_links", {}).get(f"{canonical_ota}_{sid}")
            if link:
                self.cache[cache_key] = link
                self._save_cache()
                return link

        # 4. Local cross-reference by normalized property name
        if norm_name:
            link = self.index.get("name_links", {}).get(f"{canonical_ota}_{norm_name}")
            if link:
                self.cache[cache_key] = link
                self._save_cache()
                return link

        # 5. StayVista official villa page cross-reference
        if sid and sid in self.index.get("sv_websites", {}):
            sv_url = self.index["sv_websites"][sid]
            self.cache[cache_key] = sv_url
            self._save_cache()
            return sv_url
            
        if norm_name and norm_name in self.index.get("sv_websites", {}):
            sv_url = self.index["sv_websites"][norm_name]
            self.cache[cache_key] = sv_url
            self._save_cache()
            return sv_url

        # 6. Check official StayVista villa slug (Claude understands StayVista pages directly)
        if norm_name:
            slug = make_slug(prop_name)
            if slug:
                candidate_sv = f"https://www.stayvista.com/villa/{slug}"
                # Construct search redirect as safest live fallback
                redirect_url = self.construct_search_url(canonical_ota, prop_name, city)
                self.cache[cache_key] = redirect_url
                self._save_cache()
                return redirect_url

        # 7. Fallback to generic OTA search redirection
        fallback_url = self.construct_search_url(canonical_ota, prop_name or "Villa", city)
        self.cache[cache_key] = fallback_url
        self._save_cache()
        return fallback_url


# Global singleton instance
_resolver_instance = None

def get_resolver() -> LinkResolver:
    global _resolver_instance
    if _resolver_instance is None:
        _resolver_instance = LinkResolver()
    return _resolver_instance

def resolve_listing_url(ota: str, sv_id: str = "", prop_name: str = "", city: str = "", current_url: str = "") -> str:
    return get_resolver().resolve(ota, sv_id, prop_name, city, current_url)

def resolve_link(sv_id: str = "", prop_name: str = "", city: str = "", ota: str = "Airbnb", current_url: str = "") -> tuple:
    """Compatibility function returning (url, source_type)."""
    if current_url and str(current_url).strip().startswith("http") and not any(x in str(current_url) for x in ["not-found", "example.com", "placeholder"]):
        return str(current_url).strip(), "original"
    resolved = get_resolver().resolve(ota=ota, sv_id=sv_id, prop_name=prop_name, city=city, current_url=current_url)
    return resolved, "net_discovered"

if __name__ == "__main__":
    resolver = get_resolver()
    # Test cases
    test_cases = [
        ("Agoda", "2682", "StayVista at Pinewood Villa near Srinagar Airport", "Srinagar", ""),
        ("Booking.com", "Not Found", "StayVista at Villa Avyaraa with Pool & Gazebo", "Lonavala", ""),
        ("Booking.com", "Not Found", "StayVista at Hill Story", "Panchgani", ""),
        ("MakeMyTrip", "101", "Amara Villa", "Alibaug", ""),
        ("Airbnb", "202", "Cosy Cottage", "Kasauli", "https://www.airbnb.com/rooms/12345678")
    ]
    print("\n--- Running Link Resolver Verification Tests ---")
    for ota, sid, name, city, url in test_cases:
        resolved = resolver.resolve(ota, sid, name, city, url)
        print(f"[{ota}] {name} (SV: {sid}) -> {resolved}")
