/**
 * knowledge.js — the OTA content specialist's domain knowledge.
 *
 * Everything the engine "knows" about what sells a stay on an OTA lives here:
 * which features are real title USPs, which are commodities, how each one is
 * allowed to be worded, and how short it can safely be made.
 *
 * Two rules govern every entry:
 *  1. `label` must never claim more than the listing said. Entries whose label
 *     adds a qualifier ("Private", "Infinity", "Heated", "Beachfront") are
 *     marked `needsExplicit` — they only fire when the listing text itself
 *     contains that qualifier.
 *  2. `weight` is *title strength* for an OTA guest — not how nice the amenity
 *     is. Wi-Fi is genuinely useful and scores 18; a private pool scores 96.
 */

/** Categories allow only the strongest member into a title (no "Pool • Swimming Pool"). */
export const USP_CATALOG = [
  // ---------- Water: the strongest single lever in villa/homestay titles ----------
  { id: 'private_pool', label: 'Private Pool', short: 'Pvt Pool', category: 'pool', feature: 'pool', weight: 96, needsExplicit: true,
    match: [/\bprivate\s+(?:swimming\s+)?pool\b/i, /\bpool\b[^.]{0,24}\bprivate\b/i], tags: ['group', 'family', 'luxury', 'experience'] },
  { id: 'infinity_pool', label: 'Infinity Pool', short: 'Pool', category: 'pool', feature: 'pool', weight: 97, needsExplicit: true,
    match: [/\binfinity\s+(?:edge\s+)?pool\b/i], tags: ['luxury', 'experience'] },
  { id: 'rooftop_pool', label: 'Rooftop Pool', short: 'Pool', category: 'pool', feature: 'pool', weight: 95, needsExplicit: true,
    match: [/\broof\s?top\s+pool\b/i, /\bterrace\s+pool\b/i], tags: ['luxury', 'experience'] },
  { id: 'heated_pool', label: 'Heated Pool', short: 'Pool', category: 'pool', feature: 'pool', weight: 92, needsExplicit: true,
    match: [/\bheated\s+pool\b/i, /\btemperature[- ]controlled\s+pool\b/i, /\bpool\b[^.]{0,20}\bheated\b/i], tags: ['family', 'luxury'] },
  { id: 'indoor_pool', label: 'Indoor Pool', short: 'Pool', category: 'pool', feature: 'pool', weight: 90, needsExplicit: true,
    match: [/\bindoor\s+pool\b/i, /\bcovered\s+pool\b/i], tags: ['family', 'luxury'] },
  { id: 'pool', label: 'Pool', short: 'Pool', category: 'pool', feature: 'pool', weight: 88,
    match: [/\bswimming\s+pool\b/i, /\bpool\b(?!\s*(?:table|tables|room|house|bar|cue))/i, /\bplunge\s+pool\b/i, /\bpool\s?side\b/i], tags: ['group', 'family', 'experience'] },
  { id: 'kids_pool', label: 'Kids Pool', short: 'Kids Pool', category: 'kidspool', weight: 58,
    match: [/\bkids?'?\s+pool\b/i, /\bchildren'?s?\s+pool\b/i, /\btoddler\s+pool\b/i, /\bbaby\s+pool\b/i], tags: ['family'] },
  { id: 'jacuzzi', label: 'Jacuzzi', short: 'Jacuzzi', category: 'jacuzzi', weight: 84,
    match: [/\bjacuzzi\b/i, /\bhot\s?tub\b/i, /\bwhirlpool\b/i], tags: ['luxury', 'experience', 'couple'] },
  { id: 'private_beach', label: 'Private Beach', short: 'Beach', category: 'beach', feature: 'beach', weight: 98, needsExplicit: true,
    match: [/\bprivate\s+beach\b/i], tags: ['luxury', 'experience'] },
  { id: 'beachfront', label: 'Beachfront', short: 'Beachfront', category: 'beach', feature: 'beach', weight: 97, needsExplicit: true,
    match: [/\bbeach\s?front\b/i, /\bon\s+the\s+beach\b/i, /\bbeach\s+facing\b/i, /\bsteps\s+(?:from|to)\s+the\s+beach\b/i], tags: ['experience', 'luxury', 'family'] },
  { id: 'lakefront', label: 'Lakefront', short: 'Lakefront', category: 'water', weight: 93, needsExplicit: true,
    match: [/\blake\s?front\b/i, /\blake\s?side\b/i, /\bon\s+the\s+lake\b/i], tags: ['experience', 'luxury'] },
  { id: 'riverside', label: 'Riverside', short: 'Riverside', category: 'water', weight: 90, needsExplicit: true,
    match: [/\briver\s?side\b/i, /\briver\s?front\b/i, /\bon\s+the\s+river\b/i], tags: ['experience'] },
  { id: 'waterfall', label: 'Waterfall', short: 'Waterfall', category: 'water', weight: 86,
    match: [/\bwaterfall\b/i], tags: ['experience'] },

  // ---------- Views ----------
  { id: 'sea_view', label: 'Sea View', short: 'Sea View', category: 'view', weight: 94,
    match: [/\bsea\s+views?\b/i, /\bocean\s+views?\b/i, /\bsea\s+facing\b/i], tags: ['experience', 'luxury', 'couple'] },
  { id: 'lake_view', label: 'Lake View', short: 'Lake View', category: 'view', weight: 90,
    match: [/\blake\s+views?\b/i, /\blake\s+facing\b/i], tags: ['experience', 'couple'] },
  { id: 'mountain_view', label: 'Mountain View', short: 'Mtn View', category: 'view', weight: 88,
    match: [/\bmountain\s+views?\b/i, /\bmountain\s+facing\b/i, /\bhimalayan?\s+views?\b/i, /\bsnow\s+views?\b/i], tags: ['experience', 'couple'] },
  { id: 'valley_view', label: 'Valley View', short: 'Valley View', category: 'view', weight: 88,
    match: [/\bvalley\s+views?\b/i, /\bvalley\s+facing\b/i], tags: ['experience', 'couple'] },
  { id: 'river_view', label: 'River View', short: 'River View', category: 'view', weight: 86,
    match: [/\briver\s+views?\b/i, /\briver\s+facing\b/i], tags: ['experience'] },
  { id: 'forest_view', label: 'Forest View', short: 'Forest View', category: 'view', weight: 82,
    match: [/\bforest\s+views?\b/i, /\bjungle\s+views?\b/i], tags: ['experience'] },
  { id: 'hill_view', label: 'Hill View', short: 'Hill View', category: 'view', weight: 82,
    match: [/\bhill\s+views?\b/i, /\bhills?\s+facing\b/i], tags: ['experience'] },
  { id: 'panoramic_view', label: 'Panoramic View', short: 'Views', category: 'view', weight: 85, needsExplicit: true,
    match: [/\bpanoramic\b/i, /\b360\s?(?:deg(?:ree)?s?)\s+view/i], tags: ['experience', 'luxury'] },
  { id: 'garden_view', label: 'Garden View', short: 'Garden View', category: 'view', weight: 52,
    match: [/\bgarden\s+views?\b/i], tags: [] },
  { id: 'city_view', label: 'City View', short: 'City View', category: 'view', weight: 58,
    match: [/\bcity\s+views?\b/i, /\bskyline\s+views?\b/i], tags: ['work'] },
  { id: 'pool_view', label: 'Pool View', short: 'Pool View', category: 'view', weight: 60,
    match: [/\bpool\s+views?\b/i, /\bpool\s+facing\b/i], tags: [] },

  // ---------- Setting / land ----------
  { id: 'hilltop', label: 'Hilltop', short: 'Hilltop', category: 'setting', weight: 90, needsExplicit: true,
    match: [/\bhill\s?top\b/i, /\batop\s+a\s+hill\b/i, /\bon\s+a\s+hill\b/i, /\bcliff\s?top\b/i], tags: ['experience', 'luxury'] },
  { id: 'vineyard', label: 'Vineyard', short: 'Vineyard', category: 'setting', weight: 86,
    match: [/\bvineyard\b/i, /\bwinery\b/i], tags: ['experience', 'luxury'] },
  { id: 'plantation', label: 'Plantation', short: 'Plantation', category: 'setting', weight: 82,
    match: [/\bplantation\b/i, /\bcoffee\s+estate\b/i, /\btea\s+estate\b/i, /\borchard\b/i], tags: ['experience'] },
  { id: 'farm', label: 'Farm Stay', short: 'Farm', category: 'setting', weight: 78,
    match: [/\bfarm\s?stay\b/i, /\bworking\s+farm\b/i], tags: ['experience', 'family'] },
  { id: 'heritage', label: 'Heritage', short: 'Heritage', category: 'setting', weight: 80, needsExplicit: true,
    match: [/\bheritage\b/i, /\brestored\s+(?:haveli|mansion|palace|bungalow)\b/i, /\bcolonial\s+(?:era|style)\b/i], tags: ['experience', 'luxury'] },
  { id: 'treehouse', label: 'Treehouse', short: 'Treehouse', category: 'setting', weight: 90, needsExplicit: true,
    match: [/\btree\s?house\b/i], tags: ['experience', 'couple'] },
  { id: 'secluded', label: 'Secluded', short: 'Secluded', category: 'setting', weight: 74, needsExplicit: true,
    match: [/\bsecluded\b/i, /\boff[- ]the[- ]grid\b/i], tags: ['experience', 'couple'] },
  { id: 'gated', label: 'Gated Community', short: 'Gated', category: 'setting', weight: 48, needsExplicit: true,
    match: [/\bgated\s+(?:community|society|complex)\b/i], tags: ['family'] },

  // ---------- Games & entertainment: what makes groups book ----------
  { id: 'pool_table', label: 'Pool Table', short: 'Pool Table', category: 'games', weight: 76,
    match: [/\bpool\s+table\b/i, /\bbilliards?\b/i, /\bsnooker\b/i], tags: ['group'] },
  { id: 'home_theatre', label: 'Home Theatre', short: 'Theatre', category: 'entertainment', weight: 76, needsExplicit: true,
    match: [/\bhome\s+theat(?:re|er)\b/i, /\bmini\s+theat(?:re|er)\b/i, /\bprojector\s+screen\b/i], tags: ['group', 'family', 'luxury'] },
  { id: 'projector', label: 'Projector', short: 'Projector', category: 'entertainment', weight: 64,
    match: [/\bprojector\b/i, /\bmovie\s+night\b/i, /\boutdoor\s+screen\b/i], tags: ['group', 'family'] },
  { id: 'table_tennis', label: 'Table Tennis', short: 'Table Tennis', category: 'games', weight: 66,
    match: [/\btable\s+tennis\b/i, /\bping\s?pong\b/i], tags: ['group', 'family'] },
  { id: 'foosball', label: 'Foosball', short: 'Foosball', category: 'games', weight: 60,
    match: [/\bfoos\s?ball\b/i, /\bair\s+hockey\b/i], tags: ['group', 'family'] },
  { id: 'indoor_games', label: 'Indoor Games', short: 'Games', category: 'games', weight: 62,
    match: [/\bindoor\s+games\b/i, /\bboard\s+games\b/i, /\bcarrom\b/i, /\bdarts?\b/i, /\bchess\b/i, /\bplaying\s+cards\b/i], tags: ['group', 'family'] },
  { id: 'outdoor_games', label: 'Outdoor Games', short: 'Games', category: 'games', weight: 60,
    match: [/\boutdoor\s+games\b/i, /\bbadminton\b/i, /\bcricket\s+(?:pitch|net)\b/i, /\bvolleyball\b/i, /\bbasketball\b/i, /\bfootball\s+(?:court|turf)\b/i], tags: ['group', 'family'] },
  { id: 'bar', label: 'In-House Bar', short: 'Bar', category: 'entertainment_bar', weight: 66,
    match: [/\bin[- ]house\s+bar\b/i, /\bbar\s+counter\b/i, /\bprivate\s+bar\b/i, /\bcocktail\s+bar\b/i, /\bbar\b(?!\s*(?:becue|beque|b\b))/i], tags: ['group', 'luxury'] },
  { id: 'karaoke', label: 'Karaoke', short: 'Karaoke', category: 'entertainment', weight: 58,
    match: [/\bkaraoke\b/i], tags: ['group'] },
  { id: 'music_system', label: 'Music System', short: 'Music', category: 'entertainment', weight: 40,
    match: [/\bmusic\s+system\b/i, /\bbluetooth\s+speaker\b/i, /\bsound\s+system\b/i], tags: ['group'] },
  { id: 'play_area', label: 'Kids Play Area', short: 'Play Area', category: 'kids', weight: 58,
    match: [/\bplay\s?(?:ground|area)\b/i, /\bswing\s?set\b/i, /\btrampoline\b/i, /\bsee\s?saw\b/i], tags: ['family'] },

  // ---------- Outdoor living ----------
  { id: 'bonfire', label: 'Bonfire', short: 'Bonfire', category: 'fire', weight: 72,
    match: [/\bbon\s?fire\b/i, /\bcamp\s?fire\b/i, /\bfire\s?pit\b/i], tags: ['group', 'experience', 'family'] },
  { id: 'bbq', label: 'BBQ', short: 'BBQ', category: 'bbq', weight: 68,
    match: [/\bbbq\b/i, /\bbarbe?[cq]ue\b/i, /\bgrill\b/i, /\bsigri\b/i], tags: ['group', 'family'] },
  { id: 'large_lawn', label: 'Large Lawn', short: 'Lawn', category: 'lawn', feature: 'lawn', weight: 72, needsExplicit: true,
    match: [/\b(?:large|big|huge|sprawling|spacious|expansive|vast)\s+(?:lawn|garden)\b/i, /\bacres?\s+of\s+(?:lawn|garden)\b/i], tags: ['group', 'family'] },
  { id: 'lawn', label: 'Lawn', short: 'Lawn', category: 'lawn', feature: 'lawn', weight: 64,
    match: [/\blawn\b/i, /\bgarden\b(?!\s+view)/i, /\bbackyard\b/i, /\bfront\s+yard\b/i], tags: ['group', 'family'] },
  { id: 'terrace', label: 'Terrace', short: 'Terrace', category: 'outdoor', weight: 56,
    match: [/\bterrace\b/i, /\broof\s?top\b/i, /\bsit\s?out\b/i, /\bveranda[h]?\b/i, /\bpatio\b/i], tags: ['experience'] },
  { id: 'balcony', label: 'Balcony', short: 'Balcony', category: 'outdoor', weight: 50,
    match: [/\bbalcon(?:y|ies)\b/i], tags: ['couple'] },
  { id: 'gazebo', label: 'Gazebo', short: 'Gazebo', category: 'outdoor', weight: 48,
    match: [/\bgazebo\b/i, /\bpergola\b/i, /\bcabana\b/i, /\bmachan\b/i], tags: ['experience'] },
  { id: 'hammock', label: 'Hammock', short: 'Hammock', category: 'outdoor', weight: 42,
    match: [/\bhammock\b/i, /\bswing\s+chair\b/i, /\bjhula\b/i], tags: ['couple'] },
  { id: 'open_shower', label: 'Open Shower', short: 'Open Shower', category: 'bath', weight: 56,
    match: [/\bopen\s+(?:air\s+)?shower\b/i, /\boutdoor\s+shower\b/i, /\brain\s+shower\b/i], tags: ['luxury', 'couple'] },
  { id: 'bathtub', label: 'Bathtub', short: 'Bathtub', category: 'bath', weight: 54,
    match: [/\bbath\s?tub\b/i, /\bsoaking\s+tub\b/i], tags: ['couple', 'luxury'] },

  // ---------- Service & wellness ----------
  { id: 'private_chef', label: 'Private Chef', short: 'Chef', category: 'service', feature: 'staff', weight: 74, needsExplicit: true,
    match: [/\bprivate\s+chef\b/i, /\bpersonal\s+chef\b/i, /\bin[- ]house\s+chef\b/i, /\bchef\s+on\s+(?:call|request)\b/i], tags: ['group', 'luxury'] },
  { id: 'cook', label: 'Cook On-Site', short: 'Cook', category: 'service', feature: 'staff', weight: 60,
    match: [/\bcaretaker\s+(?:cum\s+)?cook\b/i, /\bcook\s+(?:available|on\s+site|on\s+request)\b/i, /\bmeals?\s+prepared\b/i], tags: ['group', 'family'] },
  { id: 'caretaker', label: 'Caretaker', short: 'Caretaker', category: 'service', weight: 40,
    match: [/\bcare\s?taker\b/i, /\bhouse\s?keeper\b/i], tags: ['family'] },
  { id: 'breakfast', label: 'Breakfast', short: 'Breakfast', category: 'meals', weight: 52,
    match: [/\bbreakfast\s+(?:included|complimentary|free)\b/i, /\bcomplimentary\s+breakfast\b/i, /\bfree\s+breakfast\b/i], tags: ['family', 'work'] },
  { id: 'spa', label: 'Spa', short: 'Spa', category: 'wellness', weight: 76,
    match: [/\bspa\b/i, /\bmassage\s+(?:room|service)\b/i, /\bayurvedic\s+treatment\b/i], tags: ['luxury', 'couple'] },
  { id: 'sauna', label: 'Sauna', short: 'Sauna', category: 'wellness', weight: 72,
    match: [/\bsauna\b/i, /\bsteam\s+(?:room|bath)\b/i], tags: ['luxury'] },
  { id: 'gym', label: 'Gym', short: 'Gym', category: 'wellness', weight: 54,
    match: [/\bgym\b/i, /\bfitness\s+(?:centre|center|room)\b/i], tags: ['work'] },
  { id: 'yoga', label: 'Yoga Deck', short: 'Yoga', category: 'wellness', weight: 56, needsExplicit: true,
    match: [/\byoga\s+(?:deck|studio|shala|space|room)\b/i, /\bmeditation\s+(?:deck|space|room)\b/i], tags: ['experience'] },
  { id: 'fireplace', label: 'Fireplace', short: 'Fireplace', category: 'indoor', weight: 62,
    match: [/\bfire\s?place\b/i, /\bwood\s?burner\b/i, /\bangithi\b/i], tags: ['couple', 'experience'] },

  { id: 'sun_deck', label: 'Sun Deck', short: 'Sun Deck', category: 'outdoor', weight: 58,
    match: [/\bsun\s?deck\b/i, /\bsun\s+loungers?\b/i, /\bdeck\s+chairs?\b/i], tags: ['experience', 'luxury'] },
  { id: 'ev_charging', label: 'EV Charging', short: 'EV Charging', category: 'ev', weight: 46,
    match: [/\bev\s+charg(?:ing|er)\b/i, /\belectric\s+vehicle\s+charg/i, /\bcar\s+charging\s+point\b/i], tags: ['family'] },
  { id: 'staff_quarters', label: 'Staff Quarters', short: 'Staff Quarters', category: 'service', weight: 30, titleWorthy: false,
    match: [/\bstaff\s+quarters?\b/i, /\bdriver'?s?\s+(?:room|quarters?|accommodation)\b/i, /\bservant\s+quarters?\b/i], tags: [] },

  // ---------- Guest-fit signals ----------
  { id: 'pet_friendly', label: 'Pet Friendly', short: 'Pet Friendly', category: 'petfit', weight: 70,
    match: [/\bpets?\s+(?:are\s+)?(?:allowed|friendly|welcome)\b/i, /\bpet[- ]friendly\b/i, /\bdog[- ]friendly\b/i], tags: ['family'] },
  { id: 'family_friendly', label: 'Family Friendly', short: 'Family', category: 'famfit', weight: 56,
    match: [/\bfamily[- ]friendly\b/i, /\bgreat\s+for\s+(?:families|kids)\b/i, /\bkid[- ]friendly\b/i, /\bchild[- ]friendly\b/i, /\bbaby\s+(?:cot|crib)\b/i, /\bhigh\s?chair\b/i], tags: ['family'] },
  { id: 'wheelchair', label: 'Step-Free Access', short: 'Step-Free', category: 'access', weight: 44,
    match: [/\bwheel\s?chair\s+accessible\b/i, /\bstep[- ]free\s+access\b/i], tags: ['family'] },
  { id: 'work_friendly', label: 'Work Friendly', short: 'Work Ready', category: 'workfit', weight: 38,
    match: [/\bdedicated\s+work\s?space\b/i, /\bwork\s?station\b/i, /\bwork[- ]friendly\b/i, /\bstudy\s+(?:table|desk)\b/i], tags: ['work'] },
  { id: 'self_checkin', label: 'Self Check-In', short: 'Self Check-In', category: 'checkin', weight: 34,
    match: [/\bself\s+check[- ]?in\b/i, /\bkeypad\b/i, /\blockbox\b/i, /\bsmart\s+lock\b/i], tags: ['work'] },
  { id: 'events_allowed', label: 'Events Allowed', short: 'Events', category: 'events', weight: 62, needsExplicit: true,
    match: [/\bevents?\s+(?:are\s+)?allowed\b/i, /\bsuitable\s+for\s+(?:events|weddings|parties)\b/i, /\bwedding\s+venue\b/i, /\bbanquet\b/i], tags: ['group'] },

  // ---------- Commodities: real amenities, weak title material ----------
  { id: 'wifi', label: 'Wi-Fi', short: 'Wi-Fi', category: 'commodity_net', weight: 18, titleWorthy: false,
    match: [/\bwi[- ]?fi\b/i, /\bwireless\s+internet\b/i, /\bhigh[- ]speed\s+internet\b/i], tags: ['work'] },
  { id: 'ac', label: 'Air Conditioning', short: 'AC', category: 'commodity_climate', weight: 22, titleWorthy: false,
    match: [/\bair\s?condition(?:ing|ed|er)\b/i, /\bsplit\s+ac\b/i], tags: [] },
  { id: 'parking', label: 'Parking', short: 'Parking', category: 'commodity_parking', weight: 24, titleWorthy: false,
    match: [/\bfree\s+parking\b/i, /\bparking\b/i, /\bcar\s+park\b/i], tags: ['family'] },
  { id: 'kitchen', label: 'Kitchen', short: 'Kitchen', category: 'commodity_kitchen', weight: 26, titleWorthy: false,
    match: [/\bkitchen\b/i, /\bkitchenette\b/i, /\bmicrowave\b/i, /\brefrigerator\b/i, /\bfridge\b/i], tags: ['family'] },
  { id: 'tv', label: 'TV', short: 'TV', category: 'commodity_tv', weight: 16, titleWorthy: false,
    match: [/\bsmart\s+tv\b/i, /\btelevision\b/i, /\bnetflix\b/i, /\bhdtv\b/i, /\btv\b/i], tags: [] },
  { id: 'washer', label: 'Washing Machine', short: 'Washer', category: 'commodity_laundry', weight: 18, titleWorthy: false,
    match: [/\bwashing\s+machine\b/i, /\bwasher\b/i, /\blaundry\b/i], tags: ['work'] },
  { id: 'power_backup', label: 'Power Backup', short: 'Power Backup', category: 'commodity_power', weight: 28, titleWorthy: false,
    match: [/\bpower\s+back\s?up\b/i, /\bgenerator\b/i, /\binverter\b/i], tags: [] },
  { id: 'hot_water', label: 'Hot Water', short: 'Hot Water', category: 'commodity_water', weight: 14, titleWorthy: false,
    match: [/\bhot\s+water\b/i, /\bgeyser\b/i, /\bwater\s+heater\b/i], tags: [] },
  { id: 'security', label: 'Security', short: 'Security', category: 'commodity_safety', weight: 22, titleWorthy: false,
    match: [/\bcctv\b/i, /\bsecurity\s+(?:guard|cameras?|system)\b/i], tags: ['family'] },
];

/** Property types, longest form first so "Farm House" wins over "House". */
export const PROPERTY_TYPES = [
  { type: 'Farm House', short: 'Farmhouse', match: [/\bfarm\s?house\b/i] },
  { type: 'Guest House', short: 'Guesthouse', match: [/\bguest\s?house\b/i] },
  { type: 'Houseboat', short: 'Houseboat', match: [/\bhouse\s?boat\b/i] },
  { type: 'Treehouse', short: 'Treehouse', match: [/\btree\s?house\b/i] },
  { type: 'Penthouse', short: 'Penthouse', match: [/\bpent\s?house\b/i] },
  { type: 'Villa', short: 'Villa', match: [/\bvillas?\b/i] },
  { type: 'Bungalow', short: 'Bungalow', match: [/\bbungalow\b/i] },
  { type: 'Cottage', short: 'Cottage', match: [/\bcottage\b/i] },
  { type: 'Homestay', short: 'Homestay', match: [/\bhome\s?stay\b/i] },
  { type: 'Apartment', short: 'Apt', match: [/\bserviced\s+apartment\b/i, /\bapartment\b/i, /\bflat\b/i, /\bcondo\b/i] },
  { type: 'Studio', short: 'Studio', match: [/\bstudio\b/i] },
  { type: 'Cabin', short: 'Cabin', match: [/\bcabin\b/i, /\blog\s+hut\b/i] },
  { type: 'Chalet', short: 'Chalet', match: [/\bchalet\b/i] },
  { type: 'Tent', short: 'Tent', match: [/\bluxury\s+tent\b/i, /\bglamping\b/i, /\bswiss\s+tent\b/i] },
  { type: 'Haveli', short: 'Haveli', match: [/\bhaveli\b/i] },
  { type: 'Resort', short: 'Resort', match: [/\bresort\b/i] },
  { type: 'Hotel', short: 'Hotel', match: [/\bhotel\b/i] },
  { type: 'Hostel', short: 'Hostel', match: [/\bhostel\b/i] },
  { type: 'Tiny Home', short: 'Tiny Home', match: [/\btiny\s+home\b/i, /\btiny\s+house\b/i] },
  { type: 'Home', short: 'Home', match: [/\bentire\s+home\b/i, /\bentire\s+house\b/i, /\bholiday\s+home\b/i, /\bhouse\b/i] },
  { type: 'Room', short: 'Room', match: [/\bprivate\s+room\b/i, /\broom\s+in\b/i] },
];

/** Words that carry a premium claim — only usable with listing evidence. */
export const LUXURY_EVIDENCE = [
  /\bluxur(?:y|ious)\b/i, /\bpremium\b/i, /\bopulent\b/i, /\blavish\b/i, /\bupscale\b/i,
  /\bhigh[- ]end\b/i, /\bboutique\b/i, /\bdesigner\b/i, /\bexclusive\b/i, /\bplush\b/i,
  /\b5[- ]star\b/i, /\bfive[- ]star\b/i, /\bindulgent\b/i, /\bbespoke\b/i, /\bregal\b/i,
];

/**
 * Neutral vocabulary a title may use without listing evidence — connectors and
 * soft positioning words that describe a stay without asserting a fact.
 */
export const NEUTRAL_WORDS = new Set([
  'and', 'with', 'at', 'in', 'on', 'for', 'the', 'a', 'an', 'of', 'by', 'near',
  'stay', 'stays', 'retreat', 'escape', 'getaway', 'hideaway', 'haven', 'home',
  'nest', 'abode', 'bhk', 'br', 'bed', 'beds', 'bedroom', 'bedrooms', 'guest',
  'guests', 'pax', 'sleeps', 'bath', 'baths', 'bathroom', 'bathrooms',
]);

/** Claim words that must never appear unless the label that owns them fired. */
export const GATED_WORDS = [
  'private', 'infinity', 'heated', 'panoramic', 'beachfront', 'lakefront',
  'riverside', 'hilltop', 'secluded', 'heritage', 'luxury', 'luxe', 'premium',
  'exclusive', 'designer', 'boutique', 'largest', 'biggest', 'best', 'finest',
];

/** Safe substitutions used when a name must be shortened. Order matters. */
export const SHORTENINGS = [
  [/\bPrivate Pool\b/g, 'Pvt Pool'],
  [/\bSwimming Pool\b/g, 'Pool'],
  [/\bBedrooms?\b/g, 'BHK'],
  [/\bAir Conditioning\b/g, 'AC'],
  [/\bTable Tennis\b/g, 'TT'],
  [/\bMountain View\b/g, 'Mtn View'],
  [/\bHome Theatre\b/g, 'Theatre'],
  [/\bKids Play Area\b/g, 'Play Area'],
  [/\bStep-Free Access\b/g, 'Step-Free'],
  [/\bPrivate Chef\b/g, 'Chef'],
  [/\bWashing Machine\b/g, 'Washer'],
  [/ and /g, ' & '],
  [/\bFarm House\b/g, 'Farmhouse'],
  [/\bApartment\b/g, 'Apt'],
  [/\bGuest House\b/g, 'Guesthouse'],
];

/** Patterns OTAs penalise or reject in a title. */
export const TITLE_VIOLATIONS = [
  { id: 'phone', severity: 'fatal', message: 'Contains what looks like a phone number',
    test: (n) => /\+?\d[\d\s-]{7,}/.test(n) },
  { id: 'url', severity: 'fatal', message: 'Contains a URL, domain or email',
    test: (n) => /https?:\/\/|www\.|\.com|\.in\b|@/i.test(n) },
  { id: 'price', severity: 'fatal', message: 'Contains pricing or a discount claim',
    test: (n) => /₹|rs\.?\s*\d|inr\s*\d|\$\s*\d|\d+\s*(?:%|percent)\s*off|\bper night\b/i.test(n) },
  { id: 'urgency', severity: 'fatal', message: 'Contains promotional or urgency language',
    test: (n) => /\b(?:book now|hurry|limited|last minute|offer|deal|discount|sale|free stay|cheap|lowest)\b/i.test(n) },
  { id: 'superlative', severity: 'major', message: 'Unsupported superlative claim',
    test: (n) => /\b(?:best|no\.?\s?1|number one|ultimate|world[- ]class|finest|unbeatable|top[- ]rated)\b/i.test(n) },
  { id: 'caps', severity: 'major', message: 'Excessive capitalisation',
    test: (n) => (n.match(/\b[A-Z]{4,}\b/g) || []).some((w) => !['BHK', 'BBQ', 'BEDS'].includes(w)) },
  { id: 'punctuation', severity: 'major', message: 'Excessive or decorative punctuation',
    test: (n) => /[!?]|\*|#|~|\|\||,\s*,/.test(n) || /•\s*•/.test(n) },
  { id: 'emoji', severity: 'major', message: 'Contains emoji',
    test: (n) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(n) },
];

export const USP_BY_ID = new Map(USP_CATALOG.map((u) => [u.id, u]));
