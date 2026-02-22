import math

# Static dataset: (icao, display_code, name, lat, lon)
# Display code = IATA when available, otherwise 3-4 char abbreviation.
# Covers Argentina (commercial + private strips), Uruguay, Paraguay, Bolivia, Brazil, Chile.
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
