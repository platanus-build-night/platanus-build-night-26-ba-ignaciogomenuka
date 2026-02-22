import math

# Static dataset: (icao, display_code, name, lat, lon)
# Display code = IATA when available, otherwise 3-4 char abbreviation.
# Covers Argentina (commercial + private strips), Uruguay, Paraguay, Bolivia, Brazil, Chile,
# Perú, Ecuador, and United States (major hubs + key business aviation airports).
AIRPORTS = [

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Buenos Aires metropolitan area
    # ══════════════════════════════════════════════════════════════════════════
    ("SAEZ", "EZE", "Ezeiza Ministro Pistarini",           -34.8222, -58.5358),
    ("SABE", "AEP", "Aeroparque Jorge Newbery",             -34.5592, -58.4156),
    ("SADF", "SFD", "San Fernando",                         -34.4532, -58.5896),  # principal hub aviación privada BA
    ("SADP", "EPA", "El Palomar",                           -34.6099, -58.6126),
    ("SAAF", "MOR", "Morón",                                -34.6764, -58.6428),
    ("SAAZ", "ZAT", "Zárate",                               -34.0983, -59.0017),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Buenos Aires province
    # ══════════════════════════════════════════════════════════════════════════
    ("SAAI", "AZL", "Azul",                                 -36.8427, -59.8856),
    ("SAAJ", "JNI", "Junín",                                -34.5459, -60.9306),
    ("SAAK", "SUZ", "Coronel Suárez",                       -37.4475, -61.8897),
    ("SAAT", "TDL", "Tandil Héroes de Malvinas",            -37.2373, -59.2279),
    ("SAAO", "OVR", "Olavarría",                            -36.8897, -60.2168),
    ("SAAS", "GPO", "General Pico",                         -35.6963, -63.7580),
    ("SATK", "TRA", "Tres Arroyos",                         -38.3869, -60.2297),
    ("SAVS", "STE", "Santa Teresita",                       -36.5425, -56.7219),
    ("SAVY", "PEH", "Pehuajó",                              -35.8453, -61.8576),
    ("SAZV", "VLG", "Villa Gesell",                         -37.2354, -56.9563),
    ("SAZM", "MDQ", "Mar del Plata Piazzolla",              -37.9342, -57.5733),
    ("SAZB", "BHI", "Bahía Blanca Cmdte Espora",            -38.7250, -62.1693),
    ("SAZR", "RSA", "Santa Rosa",                           -36.5883, -64.2758),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Entre Ríos / Litoral
    # ══════════════════════════════════════════════════════════════════════════
    ("SAAP", "PRA", "Paraná Gen Urquiza",                   -31.7948, -60.4804),
    ("SAAC", "COC", "Concordia Comodoro Pierrestegui",      -31.2969, -57.9966),
    ("SAAG", "GCH", "Gualeguaychú",                        -33.0106, -58.6117),
    ("SACD", "COL", "Colón",                                -32.0000, -58.1500),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Corrientes / Misiones / Chaco / Formosa (NEA)
    # ══════════════════════════════════════════════════════════════════════════
    ("SARC", "CNQ", "Corrientes Piragine Niveyro",          -27.4455, -58.7619),
    ("SARM", "MCS", "Mercedes",                             -29.2213, -58.0875),
    ("SANR", "RES", "Resistencia",                          -27.4500, -59.0561),
    ("SANH", "PSA", "Pres. Roque Sáenz Peña",               -26.7531, -60.4908),
    ("SASF", "FMA", "Formosa El Pucú",                      -26.2127, -58.2281),
    ("SARI", "IGR", "Cataratas del Iguazú",                 -25.7373, -54.4734),
    ("SAVV", "VGS", "Gobernador Virasoro",                  -28.0353, -56.0514),
    ("SAAV", "SFN", "Sauce Viejo Santa Fe",                 -31.7117, -60.8117),
    ("SAAR", "ROS", "Rosario Islas Malvinas",               -32.9036, -60.7850),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Córdoba
    # ══════════════════════════════════════════════════════════════════════════
    ("SACO", "COR", "Córdoba Ambrosio Taravella",           -31.3236, -64.2082),
    ("SAOD", "RCU", "Río Cuarto Las Higueras",              -33.0851, -64.2613),
    ("SACV", "VME", "Villa María",                          -32.4197, -63.1997),
    ("SACE", "CRS", "Villa del Rosario",                    -31.5561, -63.5308),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Cuyo (Mendoza, San Juan, San Luis)
    # ══════════════════════════════════════════════════════════════════════════
    ("SAMR", "MDZ", "Mendoza El Plumerillo",                -32.8317, -68.7929),
    ("SAME", "LGS", "Malargüe Comodoro Ricardo Salinas",    -35.4936, -69.5740),
    ("SANU", "UAQ", "San Juan Domingo Sarmiento",           -31.5715, -68.4182),
    ("SALO", "LUQ", "San Luis",                             -33.2732, -66.3564),
    ("SAOU", "VDR", "Villa Dolores",                        -31.9452, -65.1463),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — NOA (Tucumán, Salta, Jujuy, La Rioja, Catamarca, S del Estero)
    # ══════════════════════════════════════════════════════════════════════════
    ("SANT", "TUC", "Tucumán Benjamín Matienzo",            -26.8409, -65.1049),
    ("SASA", "SLA", "Salta Martín M. de Güemes",            -24.8560, -65.4862),
    ("SASJ", "JUJ", "Jujuy Gob. Horacio Guzmán",           -24.3928, -65.0978),
    ("SANL", "IRJ", "La Rioja Cap. V. Almandos Almonacid",  -29.3816, -66.7958),
    ("SANC", "CTC", "Catamarca Coronel Gustavo Vargas",     -28.5956, -65.7514),
    ("SANE", "SDE", "Santiago del Estero",                  -27.7656, -64.3100),
    ("SARF", "ORA", "Orán",                                 -23.1528, -64.3292),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Neuquén / Río Negro (norpatagonia, esquí, estancias)
    # ══════════════════════════════════════════════════════════════════════════
    ("SAZN", "NQN", "Neuquén Presidente Perón",             -38.9490, -68.1557),
    ("SAHZ", "APZ", "Zapala",                               -38.9756, -70.1136),
    ("SAHC", "HOS", "Chos Malal",                           -37.4442, -70.2694),
    ("SAVB", "BRC", "Bariloche Teniente Candelaria",        -41.1512, -71.1578),
    ("SAPM", "CPC", "Chapelco San Martín de los Andes",    -40.0752, -71.1372),
    ("SAVT", "VDM", "Viedma Gov Castello",                  -40.8692, -63.0004),
    ("SAAG", "GNR", "General Roca",                         -39.0006, -67.6205),

    # ══════════════════════════════════════════════════════════════════════════
    # ARGENTINA — Patagonia (Chubut, Santa Cruz, Tierra del Fuego)
    # ══════════════════════════════════════════════════════════════════════════
    ("SAZG", "PMY", "Puerto Madryn El Tehuelche",           -42.7592, -65.1027),
    ("SAWE", "REL", "Trelew Almirante Zar",                 -43.2105, -65.2703),
    ("SAWY", "EQS", "Esquel Brigadier A. Ruiz Novaro",      -42.9076, -71.1501),
    ("SAZP", "CRD", "Comodoro Rivadavia Zubarán",          -45.7854, -67.4655),
    ("SAWP", "PSC", "Puerto Santa Cruz",                    -50.0167, -68.5822),
    ("SAWG", "RGL", "Río Gallegos Piloto Fernández",        -51.6089, -69.3126),
    ("SAWR", "RGA", "Río Grande Hermes Quijada",            -53.7877, -67.7494),
    ("SAWH", "USH", "Malvinas Argentinas Ushuaia",          -54.8433, -68.2958),
    ("SAWC", "PMQ", "Perito Moreno",                        -46.5378, -70.9786),
    ("SAWU", "GGS", "Gobernador Gregores",                  -48.7831, -70.1500),

    # ══════════════════════════════════════════════════════════════════════════
    # URUGUAY — clave para jets privados desde Buenos Aires
    # ══════════════════════════════════════════════════════════════════════════
    ("SUMU", "MVD", "Montevideo Carrasco",                  -34.8384, -56.0308),
    ("SULS", "PDP", "Punta del Este Laguna del Sauce",      -34.8551, -55.0943),  # el más importante privados
    ("SUMO", "CYR", "Colonia del Sacramento",               -34.4564, -57.7736),
    ("SUDU", "DZO", "Durazno Santa Bernardina",             -33.3597, -56.4992),
    ("SUAG", "ATI", "Artigas",                              -30.4008, -56.5079),
    ("SUCA", "PDU", "Paysandú Tydeo Larre Borges",          -32.3633, -58.0619),

    # ══════════════════════════════════════════════════════════════════════════
    # PARAGUAY
    # ══════════════════════════════════════════════════════════════════════════
    ("SGAS", "ASU", "Asunción Silvio Pettirossi",           -25.2399, -57.5191),
    ("SGCU", "AGT", "Ciudad del Este Guaraní",              -25.4545, -54.8460),

    # ══════════════════════════════════════════════════════════════════════════
    # BOLIVIA
    # ══════════════════════════════════════════════════════════════════════════
    ("SLVR", "VVI", "Santa Cruz Viru Viru",                 -17.6448, -63.1354),
    ("SLET", "SRZ", "Santa Cruz El Trompillo",              -17.8116, -63.1715),  # business aviation
    ("SLLP", "LPB", "La Paz El Alto",                       -16.5103, -68.1894),
    ("SLCB", "CBB", "Cochabamba Jorge Wilstermann",         -17.4211, -66.1771),

    # ══════════════════════════════════════════════════════════════════════════
    # BRASIL — São Paulo / Rio (destinos frecuentes jets privados argentinos)
    # ══════════════════════════════════════════════════════════════════════════
    ("SBSP", "CGH", "São Paulo Congonhas",                  -23.6277, -46.6546),  # hub biz aviation
    ("SBGR", "GRU", "São Paulo Guarulhos",                  -23.4319, -46.4678),
    ("SBJD", "JDI", "Jundiaí Rolim Adolfo Amaro",          -23.1808, -46.9440),  # privados SP
    ("SBKP", "VCP", "Campinas Viracopos",                   -23.0074, -47.1345),
    ("SBRJ", "SDU", "Rio de Janeiro Santos Dumont",         -22.9105, -43.1631),  # centro RJ
    ("SBGL", "GIG", "Rio de Janeiro Galeão",                -22.8099, -43.2506),
    ("SBCT", "CWB", "Curitiba Afonso Pena",                 -25.5285, -49.1758),
    ("SBFL", "FLN", "Florianópolis Hercílio Luz",           -27.6700, -48.5525),
    ("SBPA", "POA", "Porto Alegre Salgado Filho",           -29.9944, -51.1714),
    ("SBPE", "PET", "Pelotas",                              -31.7183, -52.3272),

    # ══════════════════════════════════════════════════════════════════════════
    # CHILE
    # ══════════════════════════════════════════════════════════════════════════
    ("SCEL", "SCL", "Santiago Arturo Merino Benítez",      -33.3930, -70.7858),
    ("SCTE", "PMC", "Puerto Montt El Tepual",               -41.4389, -73.0944),
    ("SCSE", "LSC", "La Serena La Florida",                 -29.9162, -71.1995),
    ("SCCI", "PUQ", "Punta Arenas Carlos Ibáñez",          -53.0037, -70.8542),
    ("SCVD", "ZAL", "Valdivia Pichoy",                      -39.6500, -73.0861),
    ("SCPQ", "PMY_C", "Concepción Carriel Sur",             -36.7722, -73.0631),
    ("SCAS", "ANF", "Antofagasta Cerro Moreno",             -23.4444, -70.4450),
    ("SCIP", "IQQ", "Iquique Diego Aracena",                -20.5352, -70.1813),
    ("SCCY", "CJC", "Calama El Loa",                        -22.4982, -68.9036),

    # ══════════════════════════════════════════════════════════════════════════
    # PERÚ
    # ══════════════════════════════════════════════════════════════════════════
    ("SPJC", "LIM", "Lima Jorge Chávez",                    -12.0219, -77.1143),
    ("SPZO", "CUZ", "Cusco Velasco Astete",                 -13.5357, -71.9388),
    ("SPQU", "AQP", "Arequipa Rodríguez Ballón",            -16.3411, -71.5830),
    ("SPJL", "JUL", "Juliaca Inca Manco Cápac",            -15.4671, -70.1578),
    ("SPHO", "AYP", "Ayacucho Coronel FAP",                 -13.1548, -74.2044),
    ("SPTN", "TCQ", "Tacna Coronel FAP C. Ciriani",        -18.0533, -70.2758),
    ("SPPY", "IQT", "Iquitos C.F.A.P. Francisco Secada",   -3.7847, -73.3088),
    ("SPCL", "PCL", "Pucallpa Capitán David Abenzur",       -8.3779, -74.5743),
    ("SPTN", "PIU", "Piura Cap. FAP G. Concha Iberico",    -5.2075, -80.6164),
    ("SPHI", "TRU", "Trujillo Cap. FAP C. Martínez de P.", -8.0814, -79.1088),
    ("SPNC", "HUU", "Tingo María",                          -9.8760, -76.0047),

    # ══════════════════════════════════════════════════════════════════════════
    # ECUADOR
    # ══════════════════════════════════════════════════════════════════════════
    ("SEQM", "UIO", "Quito Mariscal Sucre",                 -0.1292, -78.3575),
    ("SEGU", "GYE", "Guayaquil José Joaquín de Olmedo",    -2.1574, -79.8836),
    ("SECU", "CUE", "Cuenca Mariscal Lamar",                -2.8895, -78.9842),
    ("SENM", "MEC", "Manta Eloy Alfaro",                    -0.9460, -80.6788),
    ("SENL", "LOH", "Loja Ciudad de Catamayo",              -3.9959, -79.3717),
    ("SELT", "LTX", "Latacunga Cotopaxi",                   -0.9066, -78.6157),
    ("SEIB", "IBB", "Ibarra Atahualpa",                     0.3382, -78.1366),
    ("SEPS", "PSY", "Pastaza Río Amazonas",                 -1.5052, -78.0627),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Este (Nueva York / área metropolitana)
    # ══════════════════════════════════════════════════════════════════════════
    ("KJFK", "JFK", "New York John F. Kennedy",             40.6413, -73.7781),
    ("KEWR", "EWR", "Newark Liberty",                       40.6895, -74.1745),
    ("KLGA", "LGA", "New York LaGuardia",                   40.7769, -73.8740),
    ("KTEB", "TEB", "Teterboro",                            40.8501, -74.0608),  # biz aviation NY
    ("KHPN", "HPN", "White Plains Westchester County",     41.0670, -73.7076),  # biz aviation
    ("KFRG", "FRG", "Farmingdale Republic",                 40.7288, -73.4138),
    ("KCDW", "CDW", "Caldwell Essex County",                40.8752, -74.2816),
    ("KMMU", "MMU", "Morristown Municipal",                 40.7999, -74.4149),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Nueva Inglaterra / Mid-Atlantic
    # ══════════════════════════════════════════════════════════════════════════
    ("KBOS", "BOS", "Boston Logan",                         42.3656, -71.0096),
    ("KBED", "BED", "Bedford Hanscom Field",                42.4700, -71.2890),  # biz aviation Boston
    ("KORH", "ORH", "Worcester Regional",                   42.2673, -71.8757),
    ("KPVD", "PVD", "Providence T.F. Green",                41.7270, -71.4283),
    ("KPHL", "PHL", "Philadelphia",                         39.8721, -75.2411),
    ("KPNE", "PNE", "Philadelphia Northeast",               40.0819, -75.0107),  # biz aviation
    ("KDCA", "DCA", "Washington Reagan National",           38.8521, -77.0377),
    ("KIAD", "IAD", "Washington Dulles",                    38.9531, -77.4565),
    ("KBWI", "BWI", "Baltimore Washington",                 39.1754, -76.6682),
    ("KGAI", "GAI", "Montgomery County Airpark",            39.1683, -77.1660),  # biz DC
    ("KRIC", "RIC", "Richmond",                             37.5052, -77.3197),
    ("KORF", "ORF", "Norfolk",                              36.8976, -76.0122),
    ("KPIT", "PIT", "Pittsburgh",                           40.4915, -80.2329),
    ("KCLE", "CLE", "Cleveland Hopkins",                    41.4117, -81.8498),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Sur / Florida (gran destino argentinos)
    # ══════════════════════════════════════════════════════════════════════════
    ("KMIA", "MIA", "Miami International",                  25.7959, -80.2870),
    ("KOPF", "OPF", "Miami Opa-locka Executive",            25.9070, -80.2784),  # biz aviation Miami
    ("KFLL", "FLL", "Fort Lauderdale Hollywood",            26.0726, -80.1527),
    ("KPBI", "PBI", "Palm Beach",                           26.6832, -80.0956),
    ("KBCT", "BCT", "Boca Raton",                           26.3785, -80.1077),  # biz aviation
    ("KSRQ", "SRQ", "Sarasota Bradenton",                   27.3954, -82.5544),
    ("KTPA", "TPA", "Tampa",                                27.9755, -82.5332),
    ("KMCO", "MCO", "Orlando",                              28.4294, -81.3089),
    ("KORL", "ORL", "Orlando Executive",                    28.5455, -81.3329),  # biz aviation Orlando
    ("KJAX", "JAX", "Jacksonville",                         30.4941, -81.6879),
    ("KTLH", "TLH", "Tallahassee",                          30.3965, -84.3503),
    ("KATL", "ATL", "Atlanta Hartsfield-Jackson",           33.6407, -84.4277),
    ("KPDK", "PDK", "Atlanta Peachtree-DeKalb",             33.8756, -84.3020),  # biz aviation Atlanta
    ("KMSY", "MSY", "New Orleans Louis Armstrong",          29.9934, -90.2580),
    ("KBNA", "BNA", "Nashville",                            36.1245, -86.6782),
    ("KCLT", "CLT", "Charlotte Douglas",                    35.2140, -80.9431),
    ("KRDU", "RDU", "Raleigh-Durham",                       35.8776, -78.7875),
    ("KGSP", "GSP", "Greenville-Spartanburg",               34.8957, -82.2189),
    ("KCHS", "CHS", "Charleston",                           32.8986, -80.0405),
    ("KSAV", "SAV", "Savannah Hilton Head",                 32.1277, -81.2021),
    ("KHSV", "HSV", "Huntsville",                           34.6372, -86.7751),
    ("KBHM", "BHM", "Birmingham",                           33.5629, -86.7535),
    ("KMEM", "MEM", "Memphis",                              35.0424, -89.9767),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Texas
    # ══════════════════════════════════════════════════════════════════════════
    ("KDFW", "DFW", "Dallas Fort Worth",                    32.8998, -97.0403),
    ("KDAL", "DAL", "Dallas Love Field",                    32.8471, -96.8518),
    ("KADS", "ADS", "Dallas Addison",                       32.9686, -96.8364),  # biz aviation Dallas
    ("KFTW", "FTW", "Fort Worth Meacham",                   32.8197, -97.3624),
    ("KIAH", "IAH", "Houston George Bush",                  29.9902, -95.3368),
    ("KHOU", "HOU", "Houston Hobby",                        29.6454, -95.2789),
    ("KDWH", "DWH", "Houston David Wayne Hooks",            30.0618, -95.5548),  # biz aviation Houston
    ("KSAT", "SAT", "San Antonio",                          29.5337, -98.4698),
    ("KAUS", "AUS", "Austin-Bergstrom",                     30.1975, -97.6664),
    ("KELP", "ELP", "El Paso",                              31.8072, -106.3779),
    ("KMAF", "MAF", "Midland",                              31.9425, -102.2019),
    ("KABI", "ABI", "Abilene",                              32.4113, -99.6819),
    ("KCRP", "CRP", "Corpus Christi",                       27.7704, -97.5011),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Midwest
    # ══════════════════════════════════════════════════════════════════════════
    ("KORD", "ORD", "Chicago O'Hare",                       41.9742, -87.9073),
    ("KMDW", "MDW", "Chicago Midway",                       41.7868, -87.7522),
    ("KPWK", "PWK", "Chicago Executive",                    42.1142, -87.9015),  # biz aviation Chicago
    ("KDPA", "DPA", "Chicago DuPage",                       41.9078, -88.2486),
    ("KMSP", "MSP", "Minneapolis St. Paul",                 44.8820, -93.2218),
    ("KSTP", "STP", "St. Paul Downtown Holman",             44.9345, -93.0597),  # biz aviation MSP
    ("KDTW", "DTW", "Detroit Metropolitan",                 42.2162, -83.3554),
    ("KPTK", "PTK", "Detroit Oakland County Pontiac",       42.6654, -83.4199),  # biz aviation Detroit
    ("KSTL", "STL", "St. Louis Lambert",                    38.7487, -90.3700),
    ("KSUS", "SUS", "St. Louis Spirit of St. Louis",        38.6621, -90.6520),  # biz aviation
    ("KIND", "IND", "Indianapolis",                         39.7173, -86.2944),
    ("KCMH", "CMH", "Columbus",                             39.9980, -82.8919),
    ("KCVG", "CVG", "Cincinnati Northern Kentucky",         39.0488, -84.6678),
    ("KLUK", "LUK", "Cincinnati Lunken",                    39.1033, -84.4186),  # biz aviation
    ("KMKE", "MKE", "Milwaukee Mitchell",                   42.9472, -87.8966),
    ("KDSM", "DSM", "Des Moines",                           41.5340, -93.6631),
    ("KOMA", "OMA", "Omaha Eppley",                         41.3032, -95.8941),
    ("KMCI", "MCI", "Kansas City",                          39.2976, -94.7139),
    ("KSCK", "SCK", "Stockton Metropolitan",                37.8942, -121.2388),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Montañas / Great Plains
    # ══════════════════════════════════════════════════════════════════════════
    ("KDEN", "DEN", "Denver",                               39.8561, -104.6737),
    ("KAPA", "APA", "Denver Centennial",                    39.5701, -104.8490),  # biz aviation Denver
    ("KSLC", "SLC", "Salt Lake City",                       40.7884, -111.9778),
    ("KABQ", "ABQ", "Albuquerque",                          35.0402, -106.6090),
    ("KTUS", "TUS", "Tucson",                               32.1161, -110.9410),
    ("KPHX", "PHX", "Phoenix Sky Harbor",                   33.4373, -112.0078),
    ("KSDL", "SDL", "Scottsdale",                           33.6229, -111.9121),  # biz aviation Phoenix
    ("KDVT", "DVT", "Phoenix Deer Valley",                  33.6883, -112.0834),  # biz aviation
    ("KBIL", "BIL", "Billings Logan",                       45.8077, -108.5428),
    ("KBZN", "BZN", "Bozeman Yellowstone",                  45.7775, -111.1527),
    ("KGTF", "GTF", "Great Falls",                          47.4820, -111.3707),
    ("KBOI", "BOI", "Boise",                                43.5644, -116.2228),
    ("KCOD", "COD", "Cody Yellowstone Regional",            44.5202, -109.0238),
    ("KJAC", "JAC", "Jackson Hole",                         43.6073, -110.7377),
    ("KASE", "ASE", "Aspen Pitkin County",                  39.2232, -106.8690),  # ski resort biz
    ("KEGE", "EGE", "Eagle Vail",                           39.6426, -106.9177),  # ski resort biz
    ("KTEX", "TEX", "Telluride Regional",                   37.9538, -107.9088),  # ski resort
    ("KHDN", "HDN", "Steamboat Springs Yampa Valley",       40.4812, -107.2175),
    ("KLAS", "LAS", "Las Vegas Harry Reid",                 36.0840, -115.1537),
    ("KHND", "HND", "Las Vegas Henderson Executive",        35.9728, -115.1343),  # biz aviation LV
    ("KRNO", "RNO", "Reno-Tahoe",                           39.4991, -119.7681),
    ("KTVL", "TVL", "South Lake Tahoe",                     38.8937, -119.9950),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Pacífico / California
    # ══════════════════════════════════════════════════════════════════════════
    ("KLAX", "LAX", "Los Angeles",                          33.9425, -118.4081),
    ("KVNY", "VNY", "Van Nuys",                             34.2098, -118.4899),  # biz aviation LA
    ("KBUR", "BUR", "Burbank Hollywood Burbank",            34.2007, -118.3591),
    ("KSMO", "SMO", "Santa Monica",                         34.0158, -118.4509),
    ("KLGB", "LGB", "Long Beach",                           33.8177, -118.1516),
    ("KSNA", "SNA", "Orange County John Wayne",             33.6757, -117.8678),
    ("KSAN", "SAN", "San Diego",                            32.7336, -117.1897),
    ("KMYF", "MYF", "San Diego Montgomery Gibbs",           32.8157, -117.1399),  # biz aviation SD
    ("KSFO", "SFO", "San Francisco",                        37.6213, -122.3790),
    ("KSJC", "SJC", "San Jose",                             37.3626, -121.9290),
    ("KOAK", "OAK", "Oakland",                              37.7213, -122.2208),
    ("KRHV", "RHV", "San Jose Reid-Hillview",               37.3329, -121.8197),  # biz aviation SJ
    ("KPAO", "PAO", "Palo Alto",                            37.4613, -122.1149),  # Silicon Valley
    ("KSQL", "SQL", "San Carlos",                           37.5119, -122.2497),
    ("KCCR", "CCR", "Concord Buchanan Field",               37.9897, -122.0567),
    ("KSAC", "SAC", "Sacramento",                           38.5135, -121.4927),
    ("KSMF", "SMF", "Sacramento Int'l",                     38.6954, -121.5908),
    ("KFAT", "FAT", "Fresno Yosemite",                      36.7762, -119.7182),
    ("KBFL", "BFL", "Bakersfield Meadows Field",            35.4336, -119.0568),
    ("KSBA", "SBA", "Santa Barbara",                        34.4262, -119.8404),
    ("KSLR", "SLR", "Salinas Municipal",                    36.6627, -121.6063),
    ("KMRY", "MRY", "Monterey Regional",                    36.5870, -121.8430),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Noroeste Pacífico
    # ══════════════════════════════════════════════════════════════════════════
    ("KSEA", "SEA", "Seattle-Tacoma",                       47.4502, -122.3088),
    ("KBFI", "BFI", "Seattle Boeing Field King County",     47.5299, -122.3020),  # biz aviation SEA
    ("KRNT", "RNT", "Seattle Renton Municipal",             47.4930, -122.2157),
    ("KPDX", "PDX", "Portland",                             45.5898, -122.5951),
    ("KHIO", "HIO", "Portland Hillsboro",                   45.5408, -122.9499),  # biz aviation PDX
    ("KGEG", "GEG", "Spokane",                              47.6199, -117.5339),
    ("PANC", "ANC", "Anchorage Ted Stevens",                61.1744, -149.9960),

    # ══════════════════════════════════════════════════════════════════════════
    # ESTADOS UNIDOS — Hawái
    # ══════════════════════════════════════════════════════════════════════════
    ("PHNL", "HNL", "Honolulu Daniel K. Inouye",            21.3245, -157.9251),
    ("PHOG", "OGG", "Maui Kahului",                         20.8986, -156.4305),
    ("PHKO", "KOA", "Kona",                                 19.7388, -156.0456),

]


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def nearest_airport(lat, lon, radius_km=50):
    """Return nearest airport dict within radius_km, or None.
    Default radius raised to 50 km to cover private strips further from the threshold."""
    best_dist = radius_km + 1
    best = None
    for icao, iata, name, alat, alon in AIRPORTS:
        d = haversine(lat, lon, alat, alon)
        if d < best_dist:
            best_dist = d
            best = {"icao": icao, "iata": iata, "name": name, "distance_km": round(d, 1)}
    return best
