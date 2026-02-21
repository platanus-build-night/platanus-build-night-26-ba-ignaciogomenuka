import math

# Static dataset: (icao, iata_or_display, name, lat, lon)
# Focused on Argentina + immediate neighbours used by Argentine private aviation
AIRPORTS = [
    ("SAEZ", "EZE", "Ezeiza Ministro Pistarini",          -34.8222, -58.5358),
    ("SABE", "AEP", "Aeroparque Jorge Newbery",            -34.5592, -58.4156),
    ("SAAF", "MOR", "Morón",                               -34.6764, -58.6428),
    ("SADF", "DOT", "Don Torcuato",                        -34.5572, -58.6119),
    ("SAAR", "ROS", "Rosario Islas Malvinas",              -32.9036, -60.7850),
    ("SACO", "COR", "Córdoba Ambrosio Taravella",          -31.3236, -64.2082),
    ("SAMR", "MDZ", "Mendoza El Plumerillo",               -32.8317, -68.7929),
    ("SAZM", "MDQ", "Mar del Plata Piazzolla",             -37.9342, -57.5733),
    ("SAZB", "BHI", "Bahía Blanca Cmdte Espora",           -38.7250, -62.1693),
    ("SAZN", "NQN", "Neuquén Presidente Perón",            -38.9490, -68.1557),
    ("SAVB", "BRC", "Bariloche Teniente Candelaria",       -41.1512, -71.1578),
    ("SAPM", "CPC", "Chapelco San Martín de los Andes",   -40.0752, -71.1372),
    ("SAZP", "CRD", "Comodoro Rivadavia Zubarán",         -45.7854, -67.4655),
    ("SAWE", "REL", "Trelew Almirante Zar",                -43.2105, -65.2703),
    ("SAZG", "PMY", "Puerto Madryn El Tehuelche",          -42.7592, -65.1027),
    ("SAWG", "RGL", "Río Gallegos Piloto Fernández",       -51.6089, -69.3126),
    ("SAWH", "USH", "Malvinas Argentinas Ushuaia",         -54.8433, -68.2958),
    ("SAVT", "VDM", "Viedma Gov Castello",                 -40.8692, -63.0004),
    ("SAAG", "GNR", "General Roca",                        -39.0006, -67.6205),
    ("SAAV", "SFN", "Sauce Viejo Santa Fe",                -31.7117, -60.8117),
    ("SAAP", "PRA", "Paraná Gen Urquiza",                  -31.7948, -60.4804),
    ("SAAC", "COC", "Concordia Comodoro Pierrestegui",     -31.2969, -57.9966),
    ("SARC", "CNQ", "Corrientes Piragine Niveyro",         -27.4455, -58.7619),
    ("SANR", "RES", "Resistencia",                         -27.4500, -59.0561),
    ("SARI", "IGR", "Cataratas del Iguazú",                -25.7373, -54.4734),
    ("SANT", "TUC", "Tucumán Benjamín Matienzo",           -26.8409, -65.1049),
    ("SASA", "SLA", "Salta Martín M. de Güemes",           -24.8560, -65.4862),
    ("SASJ", "JUJ", "Jujuy Gob. Horacio Guzmán",          -24.3928, -65.0978),
    ("SAZR", "RSA", "Santa Rosa",                          -36.5883, -64.2758),
    ("SAOD", "RCU", "Río Cuarto Las Higueras",             -33.0851, -64.2613),
    ("SALO", "LUQ", "San Luis",                            -33.2732, -66.3564),
    ("SAOU", "VDR", "Villa Dolores",                       -31.9452, -65.1463),
    ("SATK", "TDL", "Tres Arroyos",                        -38.3869, -60.2297),
    ("SAZV", "VLG", "Villa Gesell",                        -37.2354, -56.9563),
    ("SAVV", "VGS", "Gobernador Virasoro",                 -28.0353, -56.0514),
    ("SARF", "ORA", "Orán",                                -23.1528, -64.3292),
    # Neighbours
    ("SUMU", "MVD", "Montevideo Carrasco",                 -34.8384, -56.0308),
    ("SUAG", "AGV", "Artigas",                             -30.4008, -56.5079),
    ("SBPA", "POA", "Porto Alegre Salgado Filho",          -29.9944, -51.1714),
    ("SCEL", "SCL", "Santiago Arturo Merino Benítez",     -33.3930, -70.7858),
    ("SCTE", "PMC", "Puerto Montt El Tepual",              -41.4389, -73.0944),
    ("SCSE", "LSC", "La Serena La Florida",                -29.9162, -71.1995),
]


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def nearest_airport(lat, lon, radius_km=35):
    """Return nearest airport dict within radius_km, or None."""
    best_dist = radius_km + 1
    best = None
    for icao, iata, name, alat, alon in AIRPORTS:
        d = haversine(lat, lon, alat, alon)
        if d < best_dist:
            best_dist = d
            best = {"icao": icao, "iata": iata, "name": name, "distance_km": round(d, 1)}
    return best
