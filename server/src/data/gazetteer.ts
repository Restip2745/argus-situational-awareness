// ─────────────────────────────────────────────────────────
// ARGUS  —  Gazetteer
// ─────────────────────────────────────────────────────────
//
// The authoritative place table. It lives on the server because coordinate
// resolution now happens once, at classification time, and is persisted —
// the client reads `lat`/`lng` and never re-derives them.
//
// Roughly half the articles come back from the model with a usable
// `location.label` but a null `lat`/`lng`, so this table is what decides
// whether an event reaches the globe at all. Two rules keep it honest:
//
//   1. A label only matches a key that appears *inside* it, never the other
//      way round. The old client-side matcher did substring containment in
//      both directions, which silently placed "Mali" in Somalia (because
//      "somalia".includes("mali")) and the whole of "Africa" in South Africa.
//   2. Labels that name no point on Earth — "Global Tech Sector", "Europe",
//      "Pacific Ocean" — resolve to `region`, not to a wrong pin. A missing
//      marker is recoverable; a confident marker in the wrong country is not.

export type GeoPrecision =
  | 'exact'      // the model supplied usable coordinates
  | 'centroid'   // resolved from the label via this table
  | 'region'     // a real area, but no defensible single point
  | 'none'       // nothing resolvable

export interface ResolvedLocation {
  lat: number | null
  lng: number | null
  precision: GeoPrecision
  /** Canonical key that produced the coordinates — for logging and debugging. */
  key: string | null
}

// ── Places ──────────────────────────────────────────────
// Approximate centroids. Country entries favour the political centre over the
// geometric one where they differ enough to matter for a marker.

/**
 * Countries, kept apart from everything else in the table.
 *
 * A caller deciding whether two stories are about the same happening needs to
 * tell a subject from a place: two things happening in Syria are two things,
 * two things happening in Conakry are usually one. Only the split makes that
 * distinction available — from the merged table `Conakry` and `Syria` are the
 * same kind of entry, and treating them alike put a war-crimes verdict in with
 * a terrorism delisting.
 */
const COUNTRIES: Record<string, [number, number]> = {
  // ── Americas ──
  'United States of America': [38.9, -77.0],
  'Canada':             [56.1, -106.3],
  'Mexico':             [23.6, -102.6],
  'Guatemala':          [15.8,  -90.2],
  'Honduras':           [15.2,  -86.2],
  'El Salvador':        [13.8,  -88.9],
  'Nicaragua':          [12.9,  -85.2],
  'Costa Rica':         [9.7,   -84.0],
  'Panama':             [8.5,   -80.8],
  'Cuba':               [21.5,  -77.8],
  'Haiti':              [19.0,  -72.3],
  'Dominican Republic': [18.7,  -70.2],
  'Jamaica':            [18.1,  -77.3],
  'Trinidad and Tobago':[10.7,  -61.2],
  'Brazil':             [-14.2, -51.9],
  'Argentina':          [-38.4, -63.6],
  'Chile':              [-35.7, -71.5],
  'Peru':               [-9.2,  -75.0],
  'Colombia':           [4.1,   -72.3],
  'Venezuela':          [6.4,   -66.6],
  'Ecuador':            [-1.8,  -78.2],
  'Bolivia':            [-16.3, -63.6],
  'Paraguay':           [-23.4, -58.4],
  'Uruguay':            [-32.5, -55.8],
  'Guyana':             [4.9,   -58.9],
  'Suriname':           [3.9,   -56.0],

  // ── Countries: Europe ──
  'United Kingdom':     [51.5,   -0.1],
  'Ireland':            [53.4,   -8.2],
  'France':             [46.2,    2.2],
  'Germany':            [51.2,   10.5],
  'Italy':              [41.9,   12.6],
  'Spain':              [40.5,   -3.7],
  'Portugal':           [39.4,   -8.2],
  'Netherlands':        [52.1,    5.3],
  'Belgium':            [50.5,    4.5],
  'Luxembourg':         [49.8,    6.1],
  'Switzerland':        [46.8,    8.2],
  'Austria':            [47.5,   14.6],
  'Poland':             [51.9,   19.1],
  'Czechia':            [49.8,   15.5],
  'Slovakia':           [48.7,   19.7],
  'Hungary':            [47.2,   19.5],
  'Romania':            [45.9,   24.9],
  'Bulgaria':           [42.7,   25.5],
  'Greece':             [39.1,   21.8],
  'Croatia':            [45.1,   15.2],
  'Slovenia':           [46.2,   15.0],
  'Serbia':             [44.0,   21.0],
  'Bosnia and Herzegovina': [43.9, 17.7],
  'Montenegro':         [42.7,   19.4],
  'North Macedonia':    [41.6,   21.7],
  'Albania':            [41.2,   20.2],
  'Kosovo':             [42.6,   20.9],
  'Sweden':             [60.1,   18.6],
  'Norway':             [60.5,    8.5],
  'Denmark':            [56.0,    9.5],
  'Finland':            [61.9,   25.7],
  'Iceland':            [64.9,  -19.0],
  'Estonia':            [58.6,   25.0],
  'Latvia':             [56.9,   24.6],
  'Lithuania':          [55.2,   23.9],
  'Belarus':            [53.7,   28.0],
  'Ukraine':            [48.4,   31.2],
  'Moldova':            [47.4,   28.4],
  'Russia':             [61.5,  105.3],
  'Cyprus':             [35.1,   33.4],
  'Malta':              [35.9,   14.4],

  // ── Countries: Middle East & Central Asia ──
  'Turkey':             [38.9,   35.2],
  'Israel':             [31.0,   35.0],
  'Palestine':          [31.9,   35.2],
  'Lebanon':            [33.9,   35.5],
  'Jordan':             [31.0,   36.1],
  'Syria':              [34.8,   38.9],
  'Iraq':               [33.2,   43.7],
  'Iran':               [32.4,   53.7],
  'Saudi Arabia':       [23.9,   45.1],
  'Yemen':              [15.6,   48.5],
  'Oman':               [21.5,   55.9],
  'United Arab Emirates':[23.4,  53.8],
  'Qatar':              [25.4,   51.2],
  'Kuwait':             [29.3,   47.5],
  'Bahrain':            [26.1,   50.6],
  'Afghanistan':        [33.9,   67.7],
  'Pakistan':           [30.4,   69.3],
  'Kazakhstan':         [48.0,   66.9],
  'Uzbekistan':         [41.4,   64.6],
  'Turkmenistan':       [38.9,   59.6],
  'Kyrgyzstan':         [41.2,   74.8],
  'Tajikistan':         [38.9,   71.3],
  'Georgia':            [42.3,   43.4],
  'Armenia':            [40.1,   45.0],
  'Azerbaijan':         [40.1,   47.6],

  // ── Countries: Asia-Pacific ──
  'China':              [35.9,  104.2],
  'Taiwan':             [23.7,  120.9],
  'Japan':              [36.2,  138.3],
  'South Korea':        [35.9,  127.8],
  'North Korea':        [40.3,  127.5],
  'Mongolia':           [46.9,  103.8],
  'India':              [20.6,   78.9],
  'Bangladesh':         [23.7,   90.4],
  'Sri Lanka':          [7.9,    80.8],
  'Nepal':              [28.4,   84.1],
  'Bhutan':             [27.5,   90.4],
  'Maldives':           [3.2,    73.2],
  'Myanmar':            [19.2,   96.7],
  'Thailand':           [13.0,  100.5],
  'Cambodia':           [12.6,  104.9],
  'Laos':               [19.9,  102.5],
  'Vietnam':            [14.1,  108.3],
  'Malaysia':           [4.2,   108.0],
  'Singapore':          [1.35,  103.8],
  'Brunei':             [4.5,   114.7],
  'Indonesia':          [-0.8,  113.9],
  'Philippines':        [12.9,  121.8],
  'Timor-Leste':        [-8.9,  125.7],
  'Ho Chi Minh City':   [10.8,  106.7],
  'Australia':          [-25.3, 133.8],
  'New Zealand':        [-41.0, 174.9],
  'Papua New Guinea':   [-6.3,  143.9],
  'Fiji':               [-17.7, 178.1],
  'Solomon Islands':    [-9.6,  160.2],

  // ── Countries: Africa ──
  'Egypt':              [26.8,   30.8],
  'Libya':              [26.3,   17.2],
  'Tunisia':            [33.9,    9.6],
  'Algeria':            [28.0,    1.7],
  'Morocco':            [31.8,   -7.1],
  'Mauritania':         [21.0,  -10.9],
  'Mali':               [17.6,   -4.0],
  'Niger':              [17.6,    8.1],
  'Chad':               [15.5,   18.7],
  'Sudan':              [12.9,   30.2],
  'South Sudan':        [7.9,    30.0],
  'Eritrea':            [15.2,   39.8],
  'Djibouti':           [11.8,   42.6],
  'Ethiopia':           [9.1,    40.5],
  'Somalia':            [5.2,    46.2],
  'Kenya':              [-0.02,  37.9],
  'Uganda':             [1.4,    32.3],
  'Rwanda':             [-1.9,   29.9],
  'Burundi':            [-3.4,   29.9],
  'Tanzania':           [-6.4,   34.9],
  'Dem. Rep. Congo':    [-4.0,   21.8],
  'Republic of the Congo': [-0.2, 15.8],
  'Central African Republic': [6.6, 20.9],
  'Cameroon':           [7.4,    12.4],
  'Nigeria':            [9.1,     8.7],
  'Ghana':              [7.9,    -1.0],
  'Ivory Coast':        [7.5,    -5.5],
  'Burkina Faso':       [12.2,   -1.6],
  'Senegal':            [14.5,  -14.5],
  'Guinea':             [9.9,   -11.3],
  'Sierra Leone':       [8.5,   -11.8],
  'Liberia':            [6.4,    -9.4],
  'Togo':               [8.6,     0.8],
  'Benin':              [9.3,     2.3],
  'Gabon':              [-0.8,   11.6],
  'Angola':             [-11.2,  17.9],
  'Zambia':             [-13.1,  27.8],
  'Zimbabwe':           [-19.0,  29.2],
  'Malawi':             [-13.3,  34.3],
  'Mozambique':         [-18.7,  35.5],
  'Botswana':           [-22.3,  24.7],
  'Namibia':            [-22.96, 18.5],
  'South Africa':       [-30.6,  22.9],
  'Madagascar':         [-18.8,  47.0],
  'Eswatini':           [-26.5,  31.5],
  'Lesotho':            [-29.6,  28.2],
  'Cape Verde':         [16.0,  -24.0],

}

/** Everything else the table can resolve: waterways, sub-national regions, US
 *  states, cities, and the Chinese-language labels for all of the above. */
const OTHER_PLACES: Record<string, [number, number]> = {
  // ── Polar ──
  'Antarctica':         [-82.0,   0.0],
  'Greenland':          [71.7,  -42.6],

  // ── Waterways and chokepoints ──
  // A geopolitical feed talks about these constantly — "Strait of Hormuz"
  // alone accounted for the largest single block of unplaced events.
  'Strait of Hormuz':   [26.6,   56.3],
  'Bab el-Mandeb':      [12.6,   43.4],
  'Suez Canal':         [30.6,   32.3],
  'Panama Canal':       [9.1,   -79.7],
  'Strait of Malacca':  [2.5,   101.4],
  'Bosphorus':          [41.1,   29.1],
  'Strait of Gibraltar':[35.9,   -5.6],
  'Taiwan Strait':      [24.0,  120.5],
  'Korea Strait':       [34.4,  129.0],
  'Red Sea':            [20.3,   38.5],
  'Black Sea':          [43.4,   34.3],
  'Baltic Sea':         [58.0,   20.0],
  'North Sea':          [56.0,    3.0],
  'Mediterranean Sea':  [35.0,   18.0],
  'Mediterranean':      [35.0,   18.0],
  'Adriatic Sea':       [43.0,   15.5],
  'Aegean Sea':         [38.5,   25.0],
  'Caspian Sea':        [41.6,   50.7],
  'Persian Gulf':       [26.5,   52.0],
  'Gulf of Aden':       [12.4,   47.5],
  'Gulf of Oman':       [24.7,   58.6],
  'Gulf of Mexico':     [25.0,  -90.0],
  'Gulf of Guinea':     [2.0,     3.0],
  'South China Sea':    [15.0,  115.0],
  'East China Sea':     [29.0,  125.0],
  'Yellow Sea':         [35.5,  123.5],
  'Sea of Japan':       [40.0,  135.0],
  'Arabian Sea':        [15.0,   65.0],
  'Bay of Bengal':      [15.0,   88.0],
  'Andaman Sea':        [10.0,   96.0],
  'Caribbean Sea':      [15.0,  -75.0],
  'Barents Sea':        [75.0,   40.0],
  'Bering Strait':      [65.8, -168.9],

  // ── Sub-national regions ──
  'Scotland':           [56.5,   -4.2],
  'Wales':              [52.3,   -3.7],
  'Northern Ireland':   [54.7,   -6.7],
  'England':            [52.4,   -1.5],
  'Catalonia':          [41.8,    1.7],
  'Sicily':             [37.6,   14.0],
  'Bavaria':            [48.9,   11.4],
  'Crimea':             [45.3,   34.4],
  'Donbas':             [48.3,   38.0],
  'Tatarstan':          [55.5,   50.9],
  'Chechnya':           [43.4,   45.7],
  'Siberia':            [60.0,   90.0],
  'Xinjiang':           [41.1,   85.3],
  'Tibet':              [31.5,   88.9],
  'Inner Mongolia':     [43.4,  113.0],
  'Hong Kong':          [22.3,  114.2],
  'Macau':              [22.2,  113.5],
  'Kashmir':            [34.0,   76.5],
  'Jammu':              [32.7,   74.9],
  'Balochistan':        [28.5,   65.9],
  'Kurdistan':          [36.5,   44.3],
  'Darfur':             [13.0,   24.0],
  'Tigray':             [14.0,   38.5],
  'Gaza':               [31.4,   34.4],
  'West Bank':          [31.9,   35.2],
  'Golan Heights':      [33.0,   35.8],
  'Sinai':              [29.5,   33.8],
  'Nagorno-Karabakh':   [39.8,   46.8],
  'Transnistria':       [47.2,   29.1],
  'Kaliningrad':        [54.7,   20.5],
  'Puerto Rico':        [18.2,  -66.5],
  'Kalimantan':         [-1.0,  114.0],
  'Mindanao':           [7.9,   125.0],
  'Java':               [-7.5,  110.0],
  'Sumatra':            [-0.6,  101.3],

  // ── US states ──
  'Alabama':        [32.8,  -86.8],
  'Alaska':         [64.7, -152.0],
  'Arizona':        [34.2, -111.6],
  'Arkansas':       [34.9,  -92.4],
  'California':     [37.2, -119.5],
  'Colorado':       [39.0, -105.5],
  'Connecticut':    [41.6,  -72.7],
  'Delaware':       [39.0,  -75.5],
  'Florida':        [28.6,  -82.4],
  'Georgia, USA':   [32.6,  -83.4],
  'Hawaii':         [20.3, -156.4],
  'Idaho':          [44.4, -114.6],
  'Illinois':       [40.0,  -89.2],
  'Indiana':        [39.9,  -86.3],
  'Iowa':           [42.1,  -93.5],
  'Kansas':         [38.5,  -98.4],
  'Kentucky':       [37.5,  -85.3],
  'Louisiana':      [31.0,  -92.0],
  'Maine':          [45.4,  -69.2],
  'Maryland':       [39.0,  -76.8],
  'Massachusetts':  [42.3,  -71.8],
  'Michigan':       [44.3,  -85.4],
  'Minnesota':      [46.3,  -94.3],
  'Mississippi':    [32.7,  -89.7],
  'Missouri':       [38.4,  -92.5],
  'Montana':        [47.0, -109.6],
  'Nebraska':       [41.5,  -99.8],
  'Nevada':         [39.4, -116.6],
  'New Hampshire':  [43.7,  -71.6],
  'New Jersey':     [40.2,  -74.7],
  'New Mexico':     [34.4, -106.1],
  'New York State': [42.9,  -75.5],
  'North Carolina': [35.6,  -79.4],
  'North Dakota':   [47.4, -100.5],
  'Ohio':           [40.3,  -82.8],
  'Oklahoma':       [35.6,  -97.5],
  'Oregon':         [43.9, -120.6],
  'Pennsylvania':   [40.9,  -77.8],
  'Rhode Island':   [41.7,  -71.6],
  'South Carolina': [33.9,  -80.9],
  'South Dakota':   [44.4, -100.2],
  'Tennessee':      [35.9,  -86.4],
  'Texas':          [31.5,  -99.3],
  'Utah':           [39.3, -111.7],
  'Vermont':        [44.1,  -72.7],
  'Virginia':       [37.5,  -78.8],
  'Washington State':[47.4, -120.5],
  'West Virginia':  [38.6,  -80.6],
  'Wisconsin':      [44.6,  -89.7],
  'Wyoming':        [43.0, -107.6],

  // ── Cities ──
  'Washington D.C.':[38.9,  -77.0],
  'New York':       [40.7,  -74.0],
  'Los Angeles':    [34.1, -118.2],
  'Chicago':        [41.9,  -87.6],
  'Boston':         [42.4,  -71.1],
  'Miami':          [25.8,  -80.2],
  'Houston':        [29.8,  -95.4],
  'Seattle':        [47.6, -122.3],
  'San Francisco':  [37.8, -122.4],
  'Detroit':        [42.3,  -83.0],
  'Ottawa':         [45.4,  -75.7],
  'Toronto':        [43.7,  -79.4],
  'Mexico City':    [19.4,  -99.1],
  'Havana':         [23.1,  -82.4],
  'Bogota':         [4.7,   -74.1],
  'Cali':           [3.45,  -76.5],
  'Caracas':        [10.5,  -66.9],
  'Lima':           [-12.0, -77.0],
  'Santiago':       [-33.5, -70.7],
  'Buenos Aires':   [-34.6, -58.4],
  'Brasilia':       [-15.8, -47.9],
  'Sao Paulo':      [-23.6, -46.6],
  'Rio de Janeiro': [-22.9, -43.2],
  'London':         [51.5,   -0.1],
  'Manchester':     [53.5,   -2.2],
  'Edinburgh':      [55.9,   -3.2],
  'Dublin':         [53.3,   -6.2],
  'Paris':          [48.9,    2.3],
  'Marseille':      [43.3,    5.4],
  'Berlin':         [52.5,   13.4],
  'Munich':         [48.1,   11.6],
  'Rome':           [41.9,   12.5],
  'Milan':          [45.5,    9.2],
  'Madrid':         [40.4,   -3.7],
  'Barcelona':      [41.4,    2.2],
  'Lisbon':         [38.7,   -9.1],
  'Amsterdam':      [52.4,    4.9],
  'Brussels':       [50.9,    4.4],
  'Geneva':         [46.2,    6.1],
  'Zurich':         [47.4,    8.5],
  'Davos':          [46.8,    9.8],
  'Vienna':         [48.2,   16.4],
  'Prague':         [50.1,   14.4],
  'Warsaw':         [52.2,   21.0],
  'Budapest':       [47.5,   19.0],
  'Athens':         [38.0,   23.7],
  'Stockholm':      [59.3,   18.1],
  'Oslo':           [59.9,   10.8],
  'Copenhagen':     [55.7,   12.6],
  'Helsinki':       [60.2,   24.9],
  'Moscow':         [55.8,   37.6],
  'St Petersburg':  [59.9,   30.3],
  'Kyiv':           [50.5,   30.5],
  'Istanbul':       [41.0,   29.0],
  'Ankara':         [39.9,   32.9],
  'Jerusalem':      [31.8,   35.2],
  'Tel Aviv':       [32.1,   34.8],
  'Gaza City':      [31.5,   34.5],
  'Beirut':         [33.9,   35.5],
  'Damascus':       [33.5,   36.3],
  'Baghdad':        [33.3,   44.4],
  'Tehran':         [35.7,   51.4],
  'Riyadh':         [24.7,   46.7],
  'Dubai':          [25.2,   55.3],
  'Doha':           [25.3,   51.5],
  'Sanaa':          [15.4,   44.2],
  'Cairo':          [30.0,   31.2],
  'Tripoli':        [32.9,   13.2],
  'Algiers':        [36.8,    3.1],
  'Rabat':          [34.0,   -6.8],
  'Khartoum':       [15.5,   32.6],
  'Addis Ababa':    [9.0,    38.8],
  'Nairobi':        [-1.3,   36.8],
  'Lagos':          [6.5,     3.4],
  'Abuja':          [9.1,     7.5],
  'Kinshasa':       [-4.4,   15.3],
  'Johannesburg':   [-26.2,  28.0],
  'Cape Town':      [-33.9,  18.4],
  'Kabul':          [34.5,   69.2],
  'Islamabad':      [33.7,   73.1],
  'New Delhi':      [28.6,   77.2],
  'Mumbai':         [19.1,   72.9],
  'Dhaka':          [23.8,   90.4],
  'Beijing':        [39.9,  116.4],
  'Shanghai':       [31.2,  121.5],
  'Guangzhou':      [23.1,  113.3],
  'Shenzhen':       [22.5,  114.1],
  'Wuhan':          [30.6,  114.3],
  'Taipei':         [25.0,  121.5],
  'Seoul':          [37.6,  127.0],
  'Pyongyang':      [39.0,  125.8],
  'Tokyo':          [35.7,  139.7],
  'Osaka':          [34.7,  135.5],
  'Bangkok':        [13.8,  100.5],
  'Hanoi':          [21.0,  105.8],
  'Jakarta':        [-6.2,  106.8],
  'Manila':         [14.6,  121.0],
  'Kuala Lumpur':   [3.15,  101.7],
  'Phnom Penh':     [11.6,  104.9],
  'Canberra':       [-35.3, 149.1],
  'Sydney':         [-33.9, 151.2],
  'Wellington':     [-41.3, 174.8],

  // ── Chinese-language labels ──
  // The model is asked for English but leaks zh-TW/zh-CN labels often enough
  // that dropping them would cost real events. Both scripts are listed.
  '北京':   [39.9,  116.4],
  '上海':   [31.2,  121.5],
  '台北':   [25.0,  121.5],
  '香港':   [22.3,  114.2],
  '澳門':   [22.2,  113.5],
  '澳门':   [22.2,  113.5],
  '廣州':   [23.1,  113.3],
  '广州':   [23.1,  113.3],
  '深圳':   [22.5,  114.1],
  '武漢':   [30.6,  114.3],
  '武汉':   [30.6,  114.3],
  '莫斯科': [55.8,   37.6],
  '華盛頓': [38.9,  -77.0],
  '华盛顿': [38.9,  -77.0],
  '紐約':   [40.7,  -74.0],
  '纽约':   [40.7,  -74.0],
  '倫敦':   [51.5,   -0.1],
  '伦敦':   [51.5,   -0.1],
  '巴黎':   [48.9,    2.3],
  '柏林':   [52.5,   13.4],
  '東京':   [35.7,  139.7],
  '东京':   [35.7,  139.7],
  '首爾':   [37.6,  127.0],
  '首尔':   [37.6,  127.0],
  '平壤':   [39.0,  125.8],
  '德黑蘭': [35.7,   51.4],
  '德黑兰': [35.7,   51.4],
  '基輔':   [50.5,   30.5],
  '基辅':   [50.5,   30.5],
  '特拉維夫': [32.1,  34.8],
  '特拉维夫': [32.1,  34.8],
  '耶路撒冷': [31.8,  35.2],
  '中國':   [35.9,  104.2],
  '中国':   [35.9,  104.2],
  '台灣':   [23.7,  120.9],
  '台湾':   [23.7,  120.9],
  '俄羅斯': [61.5,  105.3],
  '俄罗斯': [61.5,  105.3],
  '美國':   [38.9,  -77.0],
  '美国':   [38.9,  -77.0],
  '烏克蘭': [48.4,   31.2],
  '乌克兰': [48.4,   31.2],
  '以色列': [31.0,   35.0],
  '巴勒斯坦': [31.9,  35.2],
  '黎巴嫩': [33.9,   35.5],
  '伊朗':   [32.4,   53.7],
  '伊拉克': [33.2,   43.7],
  '敘利亞': [34.8,   38.9],
  '叙利亚': [34.8,   38.9],
  '葉門':   [15.6,   48.5],
  '也门':   [15.6,   48.5],
  '沙烏地阿拉伯': [23.9, 45.1],
  '沙特阿拉伯':   [23.9, 45.1],
  '土耳其': [38.9,   35.2],
  '日本':   [36.2,  138.3],
  '韓國':   [35.9,  127.8],
  '韩国':   [35.9,  127.8],
  '朝鮮':   [40.3,  127.5],
  '北韓':   [40.3,  127.5],
  '北朝鲜': [40.3,  127.5],
  '印度':   [20.6,   78.9],
  '巴基斯坦': [30.4,  69.3],
  '阿富汗': [33.9,   67.7],
  '英國':   [51.5,   -0.1],
  '英国':   [51.5,   -0.1],
  '法國':   [46.2,    2.2],
  '法国':   [46.2,    2.2],
  '德國':   [51.2,   10.5],
  '德国':   [51.2,   10.5],
  '歐盟':   [50.9,    4.4],
  '欧盟':   [50.9,    4.4],
  '加薩':   [31.4,   34.4],
  '加沙':   [31.4,   34.4],
  '約旦河西岸': [31.9, 35.2],
  '柬埔寨': [12.6,  104.9],
  '越南':   [14.1,  108.3],
  '泰國':   [13.0,  100.5],
  '泰国':   [13.0,  100.5],
  '菲律賓': [12.9,  121.8],
  '菲律宾': [12.9,  121.8],
  '印尼':   [-0.8,  113.9],
  '新加坡': [1.35,  103.8],
  '馬來西亞': [4.2,  108.0],
  '马来西亚': [4.2,  108.0],
  '緬甸':   [19.2,   96.7],
  '缅甸':   [19.2,   96.7],
  '澳洲':   [-25.3, 133.8],
  '加拿大': [56.1, -106.3],
  '巴西':   [-14.2, -51.9],
  '墨西哥': [23.6, -102.6],
  '波蘭':   [51.9,   19.1],
  '波兰':   [51.9,   19.1],
  '西班牙': [40.5,   -3.7],
  '義大利': [41.9,   12.6],
  '意大利': [41.9,   12.6],
  '希臘':   [39.1,   21.8],
  '瑞典':   [60.1,   18.6],
  '芬蘭':   [61.9,   25.7],
  '挪威':   [60.5,    8.5],
  '荷蘭':   [52.1,    5.3],
  '瑞士':   [46.8,    8.2],
  '埃及':   [26.8,   30.8],
  '利比亞': [26.3,   17.2],
  '奈及利亞': [9.1,    8.7],
  '尼日利亚': [9.1,    8.7],
  '衣索比亞': [9.1,   40.5],
  '蘇丹':   [12.9,   30.2],
  '苏丹':   [12.9,   30.2],
  '南非':   [-30.6,  22.9],
  '肯亞':   [-0.02,  37.9],
  '索馬利亞': [5.2,   46.2],
  '哈薩克': [48.0,   66.9],
  '南海':   [15.0,  115.0],
  '東海':   [29.0,  125.0],
  '台海':   [24.0,  120.5],
  '波斯灣': [26.5,   52.0],
  '霍爾木茲海峽': [26.6, 56.3],
  '霍尔木兹海峡': [26.6, 56.3],
  '紅海':   [20.3,   38.5],
  '红海':   [20.3,   38.5],
  '黑海':   [43.4,   34.3],
  '地中海': [35.0,   18.0],
  '蘇伊士運河': [30.6, 32.3],
  '麻六甲海峽': [2.5, 101.4],
  '马六甲海峡': [2.5, 101.4],
  '克里米亞': [45.3,  34.4],
  '新疆':   [41.1,   85.3],
  '西藏':   [31.5,   88.9],
}

/** The whole table, as every existing caller expects it. */
const PLACES: Record<string, [number, number]> = { ...COUNTRIES, ...OTHER_PLACES }

// ── Aliases ─────────────────────────────────────────────
// Alternate spellings, abbreviations and endonyms that must land on a
// canonical key. Written lower-case; lookup normalises the label first.

const ALIASES: Record<string, string> = {
  'united states':                'United States of America',
  'usa':                          'United States of America',
  'u.s.':                         'United States of America',
  'u.s.a.':                       'United States of America',
  'us':                           'United States of America',
  'america':                      'United States of America',
  'uk':                           'United Kingdom',
  'u.k.':                         'United Kingdom',
  'britain':                      'United Kingdom',
  'great britain':                'United Kingdom',
  'holland':                      'Netherlands',
  'czech republic':               'Czechia',
  'turkiye':                      'Turkey',
  'türkiye':                      'Turkey',
  'macedonia':                    'North Macedonia',
  'burma':                        'Myanmar',
  'myanmar/burma':                'Myanmar',
  'south korea (rok)':            'South Korea',
  'republic of korea':            'South Korea',
  'rok':                          'South Korea',
  'dprk':                         'North Korea',
  "democratic people's republic of korea": 'North Korea',
  'democratic republic of congo': 'Dem. Rep. Congo',
  'democratic republic of the congo': 'Dem. Rep. Congo',
  'dr congo':                     'Dem. Rep. Congo',
  'drc':                          'Dem. Rep. Congo',
  'congo-kinshasa':               'Dem. Rep. Congo',
  'congo':                        'Dem. Rep. Congo',
  'congo-brazzaville':            'Republic of the Congo',
  "cote d'ivoire":                'Ivory Coast',
  "côte d'ivoire":                'Ivory Coast',
  'swaziland':                    'Eswatini',
  'cabo verde':                   'Cape Verde',
  'east timor':                   'Timor-Leste',
  'uae':                          'United Arab Emirates',
  'emirates':                     'United Arab Emirates',
  'ksa':                          'Saudi Arabia',
  'palestinian territories':      'Palestine',
  'gaza strip':                   'Gaza',
  'occupied west bank':           'West Bank',
  'hormuz':                       'Strait of Hormuz',
  'strait of hormouz':            'Strait of Hormuz',
  'bab al-mandab':                'Bab el-Mandeb',
  'malacca strait':               'Strait of Malacca',
  'gibraltar':                    'Strait of Gibraltar',
  'the gulf':                     'Persian Gulf',
  'arabian gulf':                 'Persian Gulf',
  'washington dc':                'Washington D.C.',
  'washington, d.c.':             'Washington D.C.',
  'washington':                   'Washington D.C.',
  'nyc':                          'New York',
  'new york city':                'New York',
  'saint petersburg':             'St Petersburg',
  'kiev':                         'Kyiv',
  'peking':                       'Beijing',
  'bombay':                       'Mumbai',
  'delhi':                        'New Delhi',
  'saigon':                       'Ho Chi Minh City',
  'european union':               'Brussels',
  'eu':                           'Brussels',
  'nato':                         'Brussels',
  'united nations':               'New York',
  'un':                           'New York',
  'jammu and kashmir':            'Kashmir',
  'pok':                          'Kashmir',
  'the poles':                    'Antarctica',
}

// ── Regions ─────────────────────────────────────────────
// Real areas that no single marker can honestly represent. They resolve to
// `region` so the data records "there is no point here" rather than "we
// failed to find one" — the two want different treatment on the globe.

const REGIONS: string[] = [
  'global', 'globally', 'worldwide', 'international', 'earth', 'the world',
  'world',
  'europe', 'asia', 'africa', 'americas', 'oceania',
  'north america', 'south america', 'central america', 'latin america',
  'western europe', 'eastern europe', 'central europe', 'northern europe',
  'southern europe', 'the balkans', 'balkans', 'scandinavia', 'nordics',
  'middle east', 'the middle east', 'gulf states', 'levant',
  'central asia', 'south asia', 'east asia', 'southeast asia',
  'northeast asia', 'asia-pacific', 'asia pacific', 'indo-pacific',
  'west africa', 'east africa', 'north africa', 'southern africa',
  'central africa', 'sub-saharan africa', 'sahel', 'horn of africa',
  'maghreb', 'caribbean', 'the caribbean',
  'arctic', 'the arctic', 'antarctic', 'polar regions',
  'pacific ocean', 'atlantic ocean', 'indian ocean', 'southern ocean',
  'arctic ocean', 'the pacific', 'the atlantic', 'high seas', 'open ocean',
  '全球', '全世界', '世界', '國際', '国际', '歐洲', '欧洲', '亞洲', '亚洲',
  '非洲', '北美', '南美', '中東', '中东', '東南亞', '东南亚', '東北亞',
  '西非', '東非', '北非', '南亞', '中亞', '拉丁美洲', '加勒比海',
  '太平洋', '大西洋', '印度洋', '北極', '南極', '全球海洋',
]

/** Labels beginning with one of these are scope words, not places —
 *  "Global Tech Sector", "International Football Governance". */
const REGION_PREFIXES: string[] = [
  'global ', 'worldwide ', 'international ', 'world ', 'earth ',
  '全球', '國際', '国际', '世界',
]

/** Placeholders the model emits instead of leaving the label empty. They are
 *  admissions of not knowing, not areas, so they resolve to `none`. */
const NON_PLACES = new Set([
  'n/a', 'na', 'none', 'unknown', 'unspecified', 'not specified',
  'various', 'multiple', 'multiple locations', 'undisclosed', '-', '—', '未知',
])

// ── Indexes ─────────────────────────────────────────────

const PLACE_INDEX = new Map<string, string>()   // normalised → canonical key
for (const key of Object.keys(PLACES)) PLACE_INDEX.set(normalise(key), key)

const ALIAS_INDEX = new Map<string, string>()
for (const [alias, key] of Object.entries(ALIASES)) ALIAS_INDEX.set(normalise(alias), key)

const REGION_INDEX = new Set(REGIONS.map(normalise))

/** Keys eligible for containment matching. Short Latin keys are excluded —
 *  a two- or three-letter fragment matches far too much to be evidence. */
const CONTAINMENT_KEYS = Object.keys(PLACES).filter(k => k.length >= 4 || hasCjk(k))

// ── Matching ────────────────────────────────────────────

function hasCjk(s: string): boolean {
  return /[㐀-䶿一-鿿]/.test(s)
}

/** Lower-case, collapse whitespace, drop surrounding punctuation. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—.,:;()[\]]+|[\s\-–—.,:;()[\]]+$/g, '')
    .trim()
}

function lookupDirect(label: string): string | null {
  const n = normalise(label)
  if (!n) return null
  const key = PLACE_INDEX.get(n) ?? ALIAS_INDEX.get(n) ?? null
  // An alias pointing at a key that was never added would otherwise hand the
  // caller a coordinate-less "hit"; a covering test guards this too.
  return key && PLACES[key] ? key : null
}

function isRegion(label: string): boolean {
  const n = normalise(label)
  if (!n) return false
  if (REGION_INDEX.has(n)) return true
  return REGION_PREFIXES.some(p => n.startsWith(p))
}

/**
 * Break a compound label into candidate parts, most specific first.
 *
 * Only separators that genuinely join distinct places are used. Hyphens are
 * deliberately excluded — "Guinea-Bissau" and "Timor-Leste" are single names,
 * and the containment pass already handles "US-China Trade".
 */
function segments(label: string): string[] {
  return label
    .split(/\s*[/|]\s*|\s*,\s*|\s+and\s+|\s+&\s+/i)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Gazetteer key appearing inside the label as a whole word.
 *
 * Directionality is the whole point: the key must be contained in the label,
 * never the label in the key. Matching both ways is what turned "Mali" into
 * Somalia and "Africa" into South Africa.
 *
 * Where several keys match, the one ending latest wins, with the longer key
 * breaking ties. Qualified place names in English are head-final — "Eastern
 * Ukraine", "West of England", "Pakistan-administered Kashmir" — so the last
 * name mentioned is the one the label is actually about.
 */
function containmentMatch(label: string): string | null {
  const n = normalise(label)
  if (!n) return null

  let best: { key: string; end: number; len: number } | null = null

  for (const key of CONTAINMENT_KEYS) {
    const k = normalise(key)
    let end: number

    if (hasCjk(k)) {
      // No word boundaries in CJK — plain substring is the correct test.
      const at = n.lastIndexOf(k)
      if (at === -1) continue
      end = at + k.length
    } else {
      if (!n.includes(k)) continue
      // Require word boundaries so "Niger" does not match inside "Nigeria".
      const re = new RegExp(`(?:^|[^a-z0-9])(${escapeRe(k)})(?:[^a-z0-9]|$)`, 'gi')
      let at = -1
      for (let m = re.exec(n); m; m = re.exec(n)) at = m.index + m[0].indexOf(m[1])
      if (at === -1) continue
      end = at + k.length
    }

    if (!best || end > best.end || (end === best.end && k.length > best.len)) {
      best = { key, end, len: k.length }
    }
  }

  return best?.key ?? null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Public API ──────────────────────────────────────────

/**
 * Resolve a free-text location label to a canonical gazetteer key.
 * Returns null for labels naming no place we know (including regions —
 * callers that care about the difference should use `resolveLocation`).
 */
export function resolvePlaceKey(label: string): string | null {
  if (!label) return null

  // 1. The label itself.
  const direct = lookupDirect(label)
  if (direct) return direct

  // 2. Regions short-circuit before containment, so "North America" is not
  //    dragged onto the "America" alias.
  if (isRegion(label)) return null

  // 3. Compound labels — "Cali, Colombia", "Israel/Palestine".
  const parts = segments(label)
  if (parts.length > 1) {
    for (const part of parts) {
      const hit = lookupDirect(part)
      if (hit) return hit
    }
    for (const part of parts) {
      if (isRegion(part)) continue
      const hit = containmentMatch(part)
      if (hit) return hit
    }
    return null
  }

  // 4. "Eastern Ukraine", "West of England", "US-China Trade".
  return containmentMatch(label)
}

/** Centroid for a canonical key, or for any label that resolves to one. */
export function getCentroid(label: string): { lat: number; lng: number } | null {
  const key = resolvePlaceKey(label)
  if (!key) return null
  const c = PLACES[key]
  return c ? { lat: c[0], lng: c[1] } : null
}

function isUsableCoord(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false
  // Null Island: the model emitting zeros means "I don't know", not the
  // Gulf of Guinea. No article in this feed is ever genuinely at 0,0.
  if (lat === 0 && lng === 0) return false
  return true
}

/**
 * Decide where an event goes, given whatever the model produced.
 *
 * Model coordinates win when they are usable — they are the only source that
 * can be more precise than a centroid. Everything else falls through to the
 * gazetteer, and labels naming no point resolve to `region` rather than being
 * forced onto one.
 */
export function resolveLocation(
  label: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): ResolvedLocation {
  if (isUsableCoord(lat, lng)) {
    return { lat: lat as number, lng: lng as number, precision: 'exact', key: null }
  }

  const clean = (label ?? '').trim()
  if (!clean || NON_PLACES.has(normalise(clean))) {
    return { lat: null, lng: null, precision: 'none', key: null }
  }

  const key = resolvePlaceKey(clean)
  if (key) {
    const c = PLACES[key]
    return { lat: c[0], lng: c[1], precision: 'centroid', key }
  }

  if (isRegion(clean) || segments(clean).some(isRegion)) {
    return { lat: null, lng: null, precision: 'region', key: null }
  }

  return { lat: null, lng: null, precision: 'none', key: null }
}

/** Exposed for tests and tooling. */
export const _internals = { PLACES, COUNTRIES, ALIASES, REGIONS, normalise, containmentMatch, isRegion }
