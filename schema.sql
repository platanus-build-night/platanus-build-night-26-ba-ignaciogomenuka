-- =============================================================================
-- BairesRadar — Complete Database Schema
-- Supabase PostgreSQL | Run in Supabase SQL Editor
-- Idempotent: safe to re-run (uses IF NOT EXISTS, ON CONFLICT DO NOTHING)
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================================================
-- 2. EXISTING TABLES — indexes only (aircraft / positions / events already exist)
-- =============================================================================

-- aircraft
CREATE UNIQUE INDEX IF NOT EXISTS idx_aircraft_icao24
    ON aircraft (icao24);

-- positions  (core query patterns: latest-per-aircraft, time-range, geospatial)
CREATE INDEX IF NOT EXISTS idx_positions_aircraft_ts
    ON positions (aircraft_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_positions_ts
    ON positions (ts DESC);
CREATE INDEX IF NOT EXISTS idx_positions_on_ground
    ON positions (on_ground) WHERE on_ground = true;
CREATE INDEX IF NOT EXISTS idx_positions_lat_lon
    ON positions (lat, lon) WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- events  (core patterns: per-aircraft history, type filter, time-range, JSONB lookups)
CREATE INDEX IF NOT EXISTS idx_events_aircraft_ts
    ON events (aircraft_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_ts
    ON events (type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_ts
    ON events (ts DESC);
-- GIN index for meta JSONB field (destination_airport, origin_airport lookups)
CREATE INDEX IF NOT EXISTS idx_events_meta
    ON events USING GIN (meta);


-- =============================================================================
-- 3. NEW TABLE: airports
--    Replaces the static airports.py dict — enables DB-driven lookups & learning
-- =============================================================================
CREATE TABLE IF NOT EXISTS airports (
    id          serial       PRIMARY KEY,
    icao        varchar(4)   NOT NULL UNIQUE,
    iata        varchar(8)   NOT NULL,
    name        text         NOT NULL,
    city        text,
    country     char(2),          -- ISO 3166-1 alpha-2
    lat         float8       NOT NULL,
    lon         float8       NOT NULL,
    source      varchar      NOT NULL DEFAULT 'static',
    verified    bool         NOT NULL DEFAULT true,
    aliases     jsonb        NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz  NOT NULL DEFAULT NOW()
);

-- UNIQUE index: must exist before the ON CONFLICT (icao) INSERT below.
-- Also handles the case where the table pre-existed without this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_airports_icao   ON airports (icao);
CREATE INDEX        IF NOT EXISTS idx_airports_iata   ON airports (iata);
CREATE INDEX        IF NOT EXISTS idx_airports_country ON airports (country);
-- Composite for geospatial bounding-box pre-filter (haversine in app)
CREATE INDEX        IF NOT EXISTS idx_airports_lat_lon ON airports (lat, lon);


-- =============================================================================
-- 4. NEW TABLE: flights
--    Materialized flight segments derived from positions + events
-- =============================================================================
CREATE TABLE IF NOT EXISTS flights (
    id                    serial       PRIMARY KEY,
    aircraft_id           int4         NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
    departure_time        timestamptz,
    arrival_time          timestamptz,
    departure_lat         float8,
    departure_lon         float8,
    arrival_lat           float8,
    arrival_lon           float8,
    departure_airport_id  int4         REFERENCES airports(id) ON DELETE SET NULL,
    arrival_airport_id    int4         REFERENCES airports(id) ON DELETE SET NULL,
    departure_label_raw   text,
    arrival_label_raw     text,
    status                varchar      NOT NULL DEFAULT 'incomplete',
    -- status values: 'in_flight' | 'landed' | 'incomplete' | 'position_only'
    tracking_mode         varchar      NOT NULL DEFAULT 'event_derived',
    -- tracking_mode values: 'event_derived' | 'position_only' | 'inferred'
    confidence_score      float8       NOT NULL DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
    inferred              bool         NOT NULL DEFAULT false,
    source                varchar,
    reason_code           varchar,
    created_at            timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flights_aircraft_departure
    ON flights (aircraft_id, departure_time DESC);
CREATE INDEX IF NOT EXISTS idx_flights_departure_time
    ON flights (departure_time DESC);
CREATE INDEX IF NOT EXISTS idx_flights_status
    ON flights (status);
CREATE INDEX IF NOT EXISTS idx_flights_departure_airport
    ON flights (departure_airport_id) WHERE departure_airport_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flights_arrival_airport
    ON flights (arrival_airport_id) WHERE arrival_airport_id IS NOT NULL;
-- Dedup guard: one flight row per aircraft per departure time
CREATE UNIQUE INDEX IF NOT EXISTS idx_flights_aircraft_departure_unique
    ON flights (aircraft_id, departure_time);


-- =============================================================================
-- 5. NEW TABLE: unknown_airport_candidates
--    Self-learning layer for unrecognised landing/takeoff coordinates
-- =============================================================================
CREATE TABLE IF NOT EXISTS unknown_airport_candidates (
    id                  serial       PRIMARY KEY,
    raw_label           text,
    normalized_label    text,
    lat                 float8,
    lon                 float8,
    first_seen_at       timestamptz  NOT NULL DEFAULT NOW(),
    last_seen_at        timestamptz  NOT NULL DEFAULT NOW(),
    seen_count          int4         NOT NULL DEFAULT 1,
    matched_airport_id  int4         REFERENCES airports(id) ON DELETE SET NULL,
    status              varchar      NOT NULL DEFAULT 'pending',
    -- status values: 'pending' | 'matched' | 'new_airport' | 'noise'
    confidence_score    float8       NOT NULL DEFAULT 0.0 CHECK (confidence_score BETWEEN 0 AND 1),
    notes               text
);

CREATE INDEX IF NOT EXISTS idx_uac_status    ON unknown_airport_candidates (status);
CREATE INDEX IF NOT EXISTS idx_uac_last_seen ON unknown_airport_candidates (last_seen_at DESC);
-- Expression unique index — enables ON CONFLICT upsert by rounded coordinate (~1 km precision)
CREATE UNIQUE INDEX IF NOT EXISTS idx_uac_coords
    ON unknown_airport_candidates (round(lat::numeric, 2), round(lon::numeric, 2))
    WHERE lat IS NOT NULL AND lon IS NOT NULL;


-- =============================================================================
-- 6. ROW LEVEL SECURITY
--
--    Strategy:
--    - RLS enabled on all 6 tables.
--    - No policies for 'anon' or 'authenticated' roles → complete block.
--    - 'postgres' superuser bypasses RLS by default in PostgreSQL.
--    - 'service_role' (Supabase) bypasses RLS automatically.
--    - Flask backend connects as 'postgres' via DATABASE_URL → unaffected.
--    - Supabase REST API / dashboard with anon key → fully blocked.
-- =============================================================================

ALTER TABLE aircraft                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE airports                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE flights                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE unknown_airport_candidates ENABLE ROW LEVEL SECURITY;

-- Drop and recreate to make idempotent
DO $$ BEGIN
    DROP POLICY IF EXISTS "service_role_all_aircraft"   ON aircraft;
    DROP POLICY IF EXISTS "service_role_all_positions"  ON positions;
    DROP POLICY IF EXISTS "service_role_all_events"     ON events;
    DROP POLICY IF EXISTS "service_role_all_airports"   ON airports;
    DROP POLICY IF EXISTS "service_role_all_flights"    ON flights;
    DROP POLICY IF EXISTS "service_role_all_uac"        ON unknown_airport_candidates;
END $$;

-- Explicit USING (true) policies for service_role so Supabase client calls
-- using the service_role JWT also work (belt-and-suspenders alongside bypass).
CREATE POLICY "service_role_all_aircraft"
    ON aircraft FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_positions"
    ON positions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_events"
    ON events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_airports"
    ON airports FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_flights"
    ON flights FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_uac"
    ON unknown_airport_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- anon: no policies → no access (this is the default-deny when RLS is on)


-- =============================================================================
-- 7. SEED DATA: airports table
--    Source: airports.py  (246 airports: AR/UY/PY/BO/BR/CL/PE/EC/US)
-- =============================================================================
INSERT INTO airports (icao, iata, name, lat, lon, country) VALUES

-- ARGENTINA — Buenos Aires metropolitan area
('SAEZ', 'EZE', 'Ezeiza Ministro Pistarini',                -34.8222, -58.5358, 'AR'),
('SABE', 'AEP', 'Aeroparque Jorge Newbery',                  -34.5592, -58.4156, 'AR'),
('SADF', 'SFD', 'San Fernando',                              -34.4532, -58.5896, 'AR'),
('SADP', 'EPA', 'El Palomar',                                -34.6099, -58.6126, 'AR'),
('SAAF', 'MOR', 'Morón',                                     -34.6764, -58.6428, 'AR'),
('SAAZ', 'ZAT', 'Zárate',                                    -34.0983, -59.0017, 'AR'),

-- ARGENTINA — Buenos Aires province
('SAAI', 'AZL', 'Azul',                                      -36.8427, -59.8856, 'AR'),
('SAAJ', 'JNI', 'Junín',                                     -34.5459, -60.9306, 'AR'),
('SAAK', 'SUZ', 'Coronel Suárez',                            -37.4475, -61.8897, 'AR'),
('SAAT', 'TDL', 'Tandil Héroes de Malvinas',                 -37.2373, -59.2279, 'AR'),
('SAAO', 'OVR', 'Olavarría',                                 -36.8897, -60.2168, 'AR'),
('SAAS', 'GPO', 'General Pico',                              -35.6963, -63.7580, 'AR'),
('SATK', 'TRA', 'Tres Arroyos',                              -38.3869, -60.2297, 'AR'),
('SAVS', 'STE', 'Santa Teresita',                            -36.5425, -56.7219, 'AR'),
('SAVY', 'PEH', 'Pehuajó',                                   -35.8453, -61.8576, 'AR'),
('SAZV', 'VLG', 'Villa Gesell',                              -37.2354, -56.9563, 'AR'),
('SAZM', 'MDQ', 'Mar del Plata Piazzolla',                   -37.9342, -57.5733, 'AR'),
('SAZB', 'BHI', 'Bahía Blanca Cmdte Espora',                 -38.7250, -62.1693, 'AR'),
('SAZR', 'RSA', 'Santa Rosa',                                -36.5883, -64.2758, 'AR'),

-- ARGENTINA — Entre Ríos / Litoral
('SAAP', 'PRA', 'Paraná Gen Urquiza',                        -31.7948, -60.4804, 'AR'),
('SAAC', 'COC', 'Concordia Comodoro Pierrestegui',           -31.2969, -57.9966, 'AR'),
('SAAG', 'GCH', 'Gualeguaychú',                             -33.0106, -58.6117, 'AR'),
('SACD', 'COL', 'Colón',                                     -32.0000, -58.1500, 'AR'),

-- ARGENTINA — NEA (Corrientes / Misiones / Chaco / Formosa)
('SARC', 'CNQ', 'Corrientes Piragine Niveyro',               -27.4455, -58.7619, 'AR'),
('SARM', 'MCS', 'Mercedes',                                  -29.2213, -58.0875, 'AR'),
('SANR', 'RES', 'Resistencia',                               -27.4500, -59.0561, 'AR'),
('SANH', 'PSA', 'Pres. Roque Sáenz Peña',                    -26.7531, -60.4908, 'AR'),
('SASF', 'FMA', 'Formosa El Pucú',                           -26.2127, -58.2281, 'AR'),
('SARI', 'IGR', 'Cataratas del Iguazú',                      -25.7373, -54.4734, 'AR'),
('SAVV', 'VGS', 'Gobernador Virasoro',                       -28.0353, -56.0514, 'AR'),
('SAAV', 'SFN', 'Sauce Viejo Santa Fe',                      -31.7117, -60.8117, 'AR'),
('SAAR', 'ROS', 'Rosario Islas Malvinas',                    -32.9036, -60.7850, 'AR'),
('SARP', 'PSS', 'Posadas Libertador Gral. San Martín',       -27.3670, -55.9670, 'AR'),
('SATG', 'OYA', 'Goya',                                      -29.1058, -59.2189, 'AR'),
('SARL', 'AOL', 'Paso de los Libres',                        -29.6894, -57.1521, 'AR'),

-- ARGENTINA — Córdoba
('SACO', 'COR', 'Córdoba Ambrosio Taravella',                -31.3236, -64.2082, 'AR'),
('SAOD', 'RCU', 'Río Cuarto Las Higueras',                   -33.0851, -64.2613, 'AR'),
('SACV', 'VME', 'Villa María',                               -32.4197, -63.1997, 'AR'),
('SACE', 'CRS', 'Villa del Rosario',                         -31.5561, -63.5308, 'AR'),

-- ARGENTINA — Cuyo (Mendoza, San Juan, San Luis)
('SAMR', 'MDZ', 'Mendoza El Plumerillo',                     -32.8317, -68.7929, 'AR'),
('SAME', 'LGS', 'Malargüe Comodoro Ricardo Salinas',         -35.4936, -69.5740, 'AR'),
('SANU', 'UAQ', 'San Juan Domingo Sarmiento',                -31.5715, -68.4182, 'AR'),
('SALO', 'LUQ', 'San Luis',                                  -33.2732, -66.3564, 'AR'),
('SAOU', 'VDR', 'Villa Dolores',                             -31.9452, -65.1463, 'AR'),

-- ARGENTINA — NOA (Tucumán, Salta, Jujuy, La Rioja, Catamarca, S del Estero)
('SANT', 'TUC', 'Tucumán Benjamín Matienzo',                 -26.8409, -65.1049, 'AR'),
('SASA', 'SLA', 'Salta Martín M. de Güemes',                 -24.8560, -65.4862, 'AR'),
('SASJ', 'JUJ', 'Jujuy Gob. Horacio Guzmán',                -24.3928, -65.0978, 'AR'),
('SANL', 'IRJ', 'La Rioja Cap. V. Almandos Almonacid',       -29.3816, -66.7958, 'AR'),
('SANC', 'CTC', 'Catamarca Coronel Gustavo Vargas',          -28.5956, -65.7514, 'AR'),
('SANE', 'SDE', 'Santiago del Estero',                       -27.7656, -64.3100, 'AR'),
('SARF', 'ORA', 'Orán',                                      -23.1528, -64.3292, 'AR'),
('SAST', 'TTG', 'Tartagal General Enrique Mosconi',          -22.6168, -63.7930, 'AR'),
('SASM', 'MTN', 'Metán',                                     -25.5144, -64.9656, 'AR'),

-- ARGENTINA — Norpatagonia (Neuquén / Río Negro)
('SAZN', 'NQN', 'Neuquén Presidente Perón',                  -38.9490, -68.1557, 'AR'),
('SAHZ', 'APZ', 'Zapala',                                    -38.9756, -70.1136, 'AR'),
('SAHC', 'HOS', 'Chos Malal',                                -37.4442, -70.2694, 'AR'),
('SAVB', 'BRC', 'Bariloche Teniente Candelaria',             -41.1512, -71.1578, 'AR'),
('SAPM', 'CPC', 'Chapelco San Martín de los Andes',          -40.0752, -71.1372, 'AR'),
('SAVT', 'VDM', 'Viedma Gov Castello',                       -40.8692, -63.0004, 'AR'),
('SAVR', 'GNR', 'General Roca',                              -39.0006, -67.6205, 'AR'),

-- ARGENTINA — Patagonia (Chubut, Santa Cruz, Tierra del Fuego)
('SAZG', 'PMY', 'Puerto Madryn El Tehuelche',                -42.7592, -65.1027, 'AR'),
('SAWE', 'REL', 'Trelew Almirante Zar',                      -43.2105, -65.2703, 'AR'),
('SAWY', 'EQS', 'Esquel Brigadier A. Ruiz Novaro',           -42.9076, -71.1501, 'AR'),
('SAZP', 'CRD', 'Comodoro Rivadavia Zubarán',                -45.7854, -67.4655, 'AR'),
('SAWP', 'PSC', 'Puerto Santa Cruz',                         -50.0167, -68.5822, 'AR'),
('SAWG', 'RGL', 'Río Gallegos Piloto Fernández',             -51.6089, -69.3126, 'AR'),
('SAWR', 'RGA', 'Río Grande Hermes Quijada',                 -53.7877, -67.7494, 'AR'),
('SAWH', 'USH', 'Malvinas Argentinas Ushuaia',               -54.8433, -68.2958, 'AR'),
('SAWC', 'PMQ', 'Perito Moreno',                             -46.5378, -70.9786, 'AR'),
('SAWU', 'GGS', 'Gobernador Gregores',                       -48.7831, -70.1500, 'AR'),

-- URUGUAY
('SUMU', 'MVD', 'Montevideo Carrasco',                       -34.8384, -56.0308, 'UY'),
('SULS', 'PDP', 'Punta del Este Laguna del Sauce',           -34.8551, -55.0943, 'UY'),
('SUMO', 'CYR', 'Colonia del Sacramento',                    -34.4564, -57.7736, 'UY'),
('SUDU', 'DZO', 'Durazno Santa Bernardina',                  -33.3597, -56.4992, 'UY'),
('SUAG', 'ATI', 'Artigas',                                   -30.4008, -56.5079, 'UY'),
('SUCA', 'PDU', 'Paysandú Tydeo Larre Borges',               -32.3633, -58.0619, 'UY'),

-- PARAGUAY
('SGAS', 'ASU', 'Asunción Silvio Pettirossi',                -25.2399, -57.5191, 'PY'),
('SGCU', 'AGT', 'Ciudad del Este Guaraní',                   -25.4545, -54.8460, 'PY'),

-- BOLIVIA
('SLVR', 'VVI', 'Santa Cruz Viru Viru',                      -17.6448, -63.1354, 'BO'),
('SLET', 'SRZ', 'Santa Cruz El Trompillo',                   -17.8116, -63.1715, 'BO'),
('SLLP', 'LPB', 'La Paz El Alto',                            -16.5103, -68.1894, 'BO'),
('SLCB', 'CBB', 'Cochabamba Jorge Wilstermann',              -17.4211, -66.1771, 'BO'),

-- BRASIL
('SBSP', 'CGH', 'São Paulo Congonhas',                       -23.6277, -46.6546, 'BR'),
('SBGR', 'GRU', 'São Paulo Guarulhos',                       -23.4319, -46.4678, 'BR'),
('SBJD', 'JDI', 'Jundiaí Rolim Adolfo Amaro',               -23.1808, -46.9440, 'BR'),
('SBKP', 'VCP', 'Campinas Viracopos',                        -23.0074, -47.1345, 'BR'),
('SBRJ', 'SDU', 'Rio de Janeiro Santos Dumont',              -22.9105, -43.1631, 'BR'),
('SBGL', 'GIG', 'Rio de Janeiro Galeão',                     -22.8099, -43.2506, 'BR'),
('SBCT', 'CWB', 'Curitiba Afonso Pena',                      -25.5285, -49.1758, 'BR'),
('SBFL', 'FLN', 'Florianópolis Hercílio Luz',                -27.6700, -48.5525, 'BR'),
('SBPA', 'POA', 'Porto Alegre Salgado Filho',                -29.9944, -51.1714, 'BR'),
('SBPE', 'PET', 'Pelotas',                                   -31.7183, -52.3272, 'BR'),

-- CHILE
('SCEL', 'SCL', 'Santiago Arturo Merino Benítez',            -33.3930, -70.7858, 'CL'),
('SCTE', 'PMC', 'Puerto Montt El Tepual',                    -41.4389, -73.0944, 'CL'),
('SCSE', 'LSC', 'La Serena La Florida',                      -29.9162, -71.1995, 'CL'),
('SCCI', 'PUQ', 'Punta Arenas Carlos Ibáñez',               -53.0037, -70.8542, 'CL'),
('SCVD', 'ZAL', 'Valdivia Pichoy',                           -39.6500, -73.0861, 'CL'),
('SCPQ', 'PMY_C', 'Concepción Carriel Sur',                  -36.7722, -73.0631, 'CL'),
('SCAS', 'ANF', 'Antofagasta Cerro Moreno',                  -23.4444, -70.4450, 'CL'),
('SCIP', 'IQQ', 'Iquique Diego Aracena',                     -20.5352, -70.1813, 'CL'),
('SCCY', 'CJC', 'Calama El Loa',                             -22.4982, -68.9036, 'CL'),

-- PERÚ
('SPJC', 'LIM', 'Lima Jorge Chávez',                         -12.0219, -77.1143, 'PE'),
('SPZO', 'CUZ', 'Cusco Velasco Astete',                      -13.5357, -71.9388, 'PE'),
('SPQU', 'AQP', 'Arequipa Rodríguez Ballón',                 -16.3411, -71.5830, 'PE'),
('SPJL', 'JUL', 'Juliaca Inca Manco Cápac',                 -15.4671, -70.1578, 'PE'),
('SPHO', 'AYP', 'Ayacucho Coronel FAP',                      -13.1548, -74.2044, 'PE'),
('SPTN', 'TCQ', 'Tacna Coronel FAP C. Ciriani',              -18.0533, -70.2758, 'PE'),
('SPPY', 'IQT', 'Iquitos C.F.A.P. Francisco Secada',         -3.7847,  -73.3088, 'PE'),
('SPCL', 'PCL', 'Pucallpa Capitán David Abenzur',            -8.3779,  -74.5743, 'PE'),
('SPUR', 'PIU', 'Piura Cap. FAP G. Concha Iberico',          -5.2075,  -80.6164, 'PE'),
('SPHI', 'TRU', 'Trujillo Cap. FAP C. Martínez de P.',       -8.0814,  -79.1088, 'PE'),
('SPNC', 'HUU', 'Tingo María',                               -9.8760,  -76.0047, 'PE'),

-- ECUADOR
('SEQM', 'UIO', 'Quito Mariscal Sucre',                      -0.1292,  -78.3575, 'EC'),
('SEGU', 'GYE', 'Guayaquil José Joaquín de Olmedo',          -2.1574,  -79.8836, 'EC'),
('SECU', 'CUE', 'Cuenca Mariscal Lamar',                     -2.8895,  -78.9842, 'EC'),
('SENM', 'MEC', 'Manta Eloy Alfaro',                         -0.9460,  -80.6788, 'EC'),
('SENL', 'LOH', 'Loja Ciudad de Catamayo',                   -3.9959,  -79.3717, 'EC'),
('SELT', 'LTX', 'Latacunga Cotopaxi',                        -0.9066,  -78.6157, 'EC'),
('SEIB', 'IBB', 'Ibarra Atahualpa',                           0.3382,  -78.1366, 'EC'),
('SEPS', 'PSY', 'Pastaza Río Amazonas',                      -1.5052,  -78.0627, 'EC'),

-- UNITED STATES — Northeast (NY metro)
('KJFK', 'JFK', 'New York John F. Kennedy',                  40.6413,  -73.7781, 'US'),
('KEWR', 'EWR', 'Newark Liberty',                            40.6895,  -74.1745, 'US'),
('KLGA', 'LGA', 'New York LaGuardia',                        40.7769,  -73.8740, 'US'),
('KTEB', 'TEB', 'Teterboro',                                 40.8501,  -74.0608, 'US'),
('KHPN', 'HPN', 'White Plains Westchester County',           41.0670,  -73.7076, 'US'),
('KFRG', 'FRG', 'Farmingdale Republic',                      40.7288,  -73.4138, 'US'),
('KCDW', 'CDW', 'Caldwell Essex County',                     40.8752,  -74.2816, 'US'),
('KMMU', 'MMU', 'Morristown Municipal',                      40.7999,  -74.4149, 'US'),

-- UNITED STATES — New England / Mid-Atlantic
('KBOS', 'BOS', 'Boston Logan',                              42.3656,  -71.0096, 'US'),
('KBED', 'BED', 'Bedford Hanscom Field',                     42.4700,  -71.2890, 'US'),
('KORH', 'ORH', 'Worcester Regional',                        42.2673,  -71.8757, 'US'),
('KPVD', 'PVD', 'Providence T.F. Green',                     41.7270,  -71.4283, 'US'),
('KPHL', 'PHL', 'Philadelphia',                              39.8721,  -75.2411, 'US'),
('KPNE', 'PNE', 'Philadelphia Northeast',                    40.0819,  -75.0107, 'US'),
('KDCA', 'DCA', 'Washington Reagan National',                38.8521,  -77.0377, 'US'),
('KIAD', 'IAD', 'Washington Dulles',                         38.9531,  -77.4565, 'US'),
('KBWI', 'BWI', 'Baltimore Washington',                      39.1754,  -76.6682, 'US'),
('KGAI', 'GAI', 'Montgomery County Airpark',                 39.1683,  -77.1660, 'US'),
('KRIC', 'RIC', 'Richmond',                                  37.5052,  -77.3197, 'US'),
('KORF', 'ORF', 'Norfolk',                                   36.8976,  -76.0122, 'US'),
('KPIT', 'PIT', 'Pittsburgh',                                40.4915,  -80.2329, 'US'),
('KCLE', 'CLE', 'Cleveland Hopkins',                         41.4117,  -81.8498, 'US'),

-- UNITED STATES — South / Florida
('KMIA', 'MIA', 'Miami International',                       25.7959,  -80.2870, 'US'),
('KOPF', 'OPF', 'Miami Opa-locka Executive',                 25.9070,  -80.2784, 'US'),
('KFLL', 'FLL', 'Fort Lauderdale Hollywood',                 26.0726,  -80.1527, 'US'),
('KPBI', 'PBI', 'Palm Beach',                                26.6832,  -80.0956, 'US'),
('KBCT', 'BCT', 'Boca Raton',                                26.3785,  -80.1077, 'US'),
('KSRQ', 'SRQ', 'Sarasota Bradenton',                        27.3954,  -82.5544, 'US'),
('KTPA', 'TPA', 'Tampa',                                     27.9755,  -82.5332, 'US'),
('KMCO', 'MCO', 'Orlando',                                   28.4294,  -81.3089, 'US'),
('KORL', 'ORL', 'Orlando Executive',                         28.5455,  -81.3329, 'US'),
('KJAX', 'JAX', 'Jacksonville',                              30.4941,  -81.6879, 'US'),
('KTLH', 'TLH', 'Tallahassee',                              30.3965,  -84.3503, 'US'),
('KATL', 'ATL', 'Atlanta Hartsfield-Jackson',                33.6407,  -84.4277, 'US'),
('KPDK', 'PDK', 'Atlanta Peachtree-DeKalb',                  33.8756,  -84.3020, 'US'),
('KMSY', 'MSY', 'New Orleans Louis Armstrong',               29.9934,  -90.2580, 'US'),
('KBNA', 'BNA', 'Nashville',                                 36.1245,  -86.6782, 'US'),
('KCLT', 'CLT', 'Charlotte Douglas',                         35.2140,  -80.9431, 'US'),
('KRDU', 'RDU', 'Raleigh-Durham',                            35.8776,  -78.7875, 'US'),
('KGSP', 'GSP', 'Greenville-Spartanburg',                    34.8957,  -82.2189, 'US'),
('KCHS', 'CHS', 'Charleston',                                32.8986,  -80.0405, 'US'),
('KSAV', 'SAV', 'Savannah Hilton Head',                      32.1277,  -81.2021, 'US'),
('KHSV', 'HSV', 'Huntsville',                                34.6372,  -86.7751, 'US'),
('KBHM', 'BHM', 'Birmingham',                                33.5629,  -86.7535, 'US'),
('KMEM', 'MEM', 'Memphis',                                   35.0424,  -89.9767, 'US'),

-- UNITED STATES — Texas
('KDFW', 'DFW', 'Dallas Fort Worth',                         32.8998,  -97.0403, 'US'),
('KDAL', 'DAL', 'Dallas Love Field',                         32.8471,  -96.8518, 'US'),
('KADS', 'ADS', 'Dallas Addison',                            32.9686,  -96.8364, 'US'),
('KFTW', 'FTW', 'Fort Worth Meacham',                        32.8197,  -97.3624, 'US'),
('KIAH', 'IAH', 'Houston George Bush',                       29.9902,  -95.3368, 'US'),
('KHOU', 'HOU', 'Houston Hobby',                             29.6454,  -95.2789, 'US'),
('KDWH', 'DWH', 'Houston David Wayne Hooks',                 30.0618,  -95.5548, 'US'),
('KSAT', 'SAT', 'San Antonio',                               29.5337,  -98.4698, 'US'),
('KAUS', 'AUS', 'Austin-Bergstrom',                          30.1975,  -97.6664, 'US'),
('KELP', 'ELP', 'El Paso',                                   31.8072, -106.3779, 'US'),
('KMAF', 'MAF', 'Midland',                                   31.9425, -102.2019, 'US'),
('KABI', 'ABI', 'Abilene',                                   32.4113,  -99.6819, 'US'),
('KCRP', 'CRP', 'Corpus Christi',                            27.7704,  -97.5011, 'US'),

-- UNITED STATES — Midwest
('KORD', 'ORD', 'Chicago O''Hare',                           41.9742,  -87.9073, 'US'),
('KMDW', 'MDW', 'Chicago Midway',                            41.7868,  -87.7522, 'US'),
('KPWK', 'PWK', 'Chicago Executive',                         42.1142,  -87.9015, 'US'),
('KDPA', 'DPA', 'Chicago DuPage',                            41.9078,  -88.2486, 'US'),
('KMSP', 'MSP', 'Minneapolis St. Paul',                      44.8820,  -93.2218, 'US'),
('KSTP', 'STP', 'St. Paul Downtown Holman',                  44.9345,  -93.0597, 'US'),
('KDTW', 'DTW', 'Detroit Metropolitan',                      42.2162,  -83.3554, 'US'),
('KPTK', 'PTK', 'Detroit Oakland County Pontiac',            42.6654,  -83.4199, 'US'),
('KSTL', 'STL', 'St. Louis Lambert',                         38.7487,  -90.3700, 'US'),
('KSUS', 'SUS', 'St. Louis Spirit of St. Louis',             38.6621,  -90.6520, 'US'),
('KIND', 'IND', 'Indianapolis',                              39.7173,  -86.2944, 'US'),
('KCMH', 'CMH', 'Columbus',                                  39.9980,  -82.8919, 'US'),
('KCVG', 'CVG', 'Cincinnati Northern Kentucky',              39.0488,  -84.6678, 'US'),
('KLUK', 'LUK', 'Cincinnati Lunken',                         39.1033,  -84.4186, 'US'),
('KMKE', 'MKE', 'Milwaukee Mitchell',                        42.9472,  -87.8966, 'US'),
('KDSM', 'DSM', 'Des Moines',                                41.5340,  -93.6631, 'US'),
('KOMA', 'OMA', 'Omaha Eppley',                              41.3032,  -95.8941, 'US'),
('KMCI', 'MCI', 'Kansas City',                               39.2976,  -94.7139, 'US'),
('KSCK', 'SCK', 'Stockton Metropolitan',                     37.8942, -121.2388, 'US'),

-- UNITED STATES — Mountains / Great Plains
('KDEN', 'DEN', 'Denver',                                    39.8561, -104.6737, 'US'),
('KAPA', 'APA', 'Denver Centennial',                         39.5701, -104.8490, 'US'),
('KSLC', 'SLC', 'Salt Lake City',                            40.7884, -111.9778, 'US'),
('KABQ', 'ABQ', 'Albuquerque',                               35.0402, -106.6090, 'US'),
('KTUS', 'TUS', 'Tucson',                                    32.1161, -110.9410, 'US'),
('KPHX', 'PHX', 'Phoenix Sky Harbor',                        33.4373, -112.0078, 'US'),
('KSDL', 'SDL', 'Scottsdale',                                33.6229, -111.9121, 'US'),
('KDVT', 'DVT', 'Phoenix Deer Valley',                       33.6883, -112.0834, 'US'),
('KBIL', 'BIL', 'Billings Logan',                            45.8077, -108.5428, 'US'),
('KBZN', 'BZN', 'Bozeman Yellowstone',                       45.7775, -111.1527, 'US'),
('KGTF', 'GTF', 'Great Falls',                               47.4820, -111.3707, 'US'),
('KBOI', 'BOI', 'Boise',                                     43.5644, -116.2228, 'US'),
('KCOD', 'COD', 'Cody Yellowstone Regional',                 44.5202, -109.0238, 'US'),
('KJAC', 'JAC', 'Jackson Hole',                              43.6073, -110.7377, 'US'),
('KASE', 'ASE', 'Aspen Pitkin County',                       39.2232, -106.8690, 'US'),
('KEGE', 'EGE', 'Eagle Vail',                                39.6426, -106.9177, 'US'),
('KTEX', 'TEX', 'Telluride Regional',                        37.9538, -107.9088, 'US'),
('KHDN', 'HDN', 'Steamboat Springs Yampa Valley',            40.4812, -107.2175, 'US'),
('KLAS', 'LAS', 'Las Vegas Harry Reid',                      36.0840, -115.1537, 'US'),
('KHND', 'HND', 'Las Vegas Henderson Executive',             35.9728, -115.1343, 'US'),
('KRNO', 'RNO', 'Reno-Tahoe',                                39.4991, -119.7681, 'US'),
('KTVL', 'TVL', 'South Lake Tahoe',                          38.8937, -119.9950, 'US'),

-- UNITED STATES — Pacific / California
('KLAX', 'LAX', 'Los Angeles',                               33.9425, -118.4081, 'US'),
('KVNY', 'VNY', 'Van Nuys',                                  34.2098, -118.4899, 'US'),
('KBUR', 'BUR', 'Burbank Hollywood Burbank',                 34.2007, -118.3591, 'US'),
('KSMO', 'SMO', 'Santa Monica',                              34.0158, -118.4509, 'US'),
('KLGB', 'LGB', 'Long Beach',                                33.8177, -118.1516, 'US'),
('KSNA', 'SNA', 'Orange County John Wayne',                  33.6757, -117.8678, 'US'),
('KSAN', 'SAN', 'San Diego',                                 32.7336, -117.1897, 'US'),
('KMYF', 'MYF', 'San Diego Montgomery Gibbs',                32.8157, -117.1399, 'US'),
('KSFO', 'SFO', 'San Francisco',                             37.6213, -122.3790, 'US'),
('KSJC', 'SJC', 'San Jose',                                  37.3626, -121.9290, 'US'),
('KOAK', 'OAK', 'Oakland',                                   37.7213, -122.2208, 'US'),
('KRHV', 'RHV', 'San Jose Reid-Hillview',                    37.3329, -121.8197, 'US'),
('KPAO', 'PAO', 'Palo Alto',                                 37.4613, -122.1149, 'US'),
('KSQL', 'SQL', 'San Carlos',                                37.5119, -122.2497, 'US'),
('KCCR', 'CCR', 'Concord Buchanan Field',                    37.9897, -122.0567, 'US'),
('KSAC', 'SAC', 'Sacramento',                                38.5135, -121.4927, 'US'),
('KSMF', 'SMF', 'Sacramento Int''l',                         38.6954, -121.5908, 'US'),
('KFAT', 'FAT', 'Fresno Yosemite',                           36.7762, -119.7182, 'US'),
('KBFL', 'BFL', 'Bakersfield Meadows Field',                 35.4336, -119.0568, 'US'),
('KSBA', 'SBA', 'Santa Barbara',                             34.4262, -119.8404, 'US'),
('KSLR', 'SLR', 'Salinas Municipal',                         36.6627, -121.6063, 'US'),
('KMRY', 'MRY', 'Monterey Regional',                         36.5870, -121.8430, 'US'),

-- UNITED STATES — Pacific Northwest
('KSEA', 'SEA', 'Seattle-Tacoma',                            47.4502, -122.3088, 'US'),
('KBFI', 'BFI', 'Seattle Boeing Field King County',          47.5299, -122.3020, 'US'),
('KRNT', 'RNT', 'Seattle Renton Municipal',                  47.4930, -122.2157, 'US'),
('KPDX', 'PDX', 'Portland',                                  45.5898, -122.5951, 'US'),
('KHIO', 'HIO', 'Portland Hillsboro',                        45.5408, -122.9499, 'US'),
('KGEG', 'GEG', 'Spokane',                                   47.6199, -117.5339, 'US'),
('PANC', 'ANC', 'Anchorage Ted Stevens',                     61.1744, -149.9960, 'US'),

-- UNITED STATES — Hawaii
('PHNL', 'HNL', 'Honolulu Daniel K. Inouye',                 21.3245, -157.9251, 'US'),
('PHOG', 'OGG', 'Maui Kahului',                              20.8986, -156.4305, 'US'),
('PHKO', 'KOA', 'Kona',                                      19.7388, -156.0456, 'US')

ON CONFLICT (icao) DO NOTHING;


-- =============================================================================
-- 8. BACKFILL: flights table from existing events
--    Pairs each TAKEOFF with the next LANDING within 16h for same aircraft.
--    Run once after applying this schema to populate historical flight records.
-- =============================================================================
INSERT INTO flights (
    aircraft_id,
    departure_time,
    arrival_time,
    departure_label_raw,
    arrival_label_raw,
    departure_airport_id,
    arrival_airport_id,
    status,
    tracking_mode,
    confidence_score,
    inferred,
    source,
    reason_code
)
SELECT
    t.aircraft_id,
    t.ts                                            AS departure_time,
    l.ts                                            AS arrival_time,
    t.meta->>'origin_airport'                       AS departure_label_raw,
    l.meta->>'destination_airport'                  AS arrival_label_raw,
    dep_apt.id                                      AS departure_airport_id,
    arr_apt.id                                      AS arrival_airport_id,
    CASE WHEN l.ts IS NOT NULL THEN 'landed' ELSE 'incomplete' END AS status,
    'event_derived'                                 AS tracking_mode,
    CASE
        WHEN l.ts IS NOT NULL
         AND t.meta->>'origin_airport' IS NOT NULL
         AND t.meta->>'origin_airport' <> 'UNKNOWN'
         AND l.meta->>'destination_airport' IS NOT NULL
         AND l.meta->>'destination_airport' <> 'UNKNOWN'
        THEN 0.9
        WHEN l.ts IS NOT NULL THEN 0.7
        ELSE 0.4
    END                                             AS confidence_score,
    false                                           AS inferred,
    t.meta->>'source'                               AS source,
    'backfill_from_events'                          AS reason_code
FROM events t
LEFT JOIN LATERAL (
    SELECT l2.ts, l2.meta FROM events l2
    WHERE l2.aircraft_id = t.aircraft_id
      AND l2.type = 'LANDING'
      AND l2.ts > t.ts
      AND l2.ts < t.ts + INTERVAL '16 hours'
    ORDER BY l2.ts ASC LIMIT 1
) l ON true
LEFT JOIN airports dep_apt ON dep_apt.iata = t.meta->>'origin_airport'
LEFT JOIN airports arr_apt ON arr_apt.iata = l.meta->>'destination_airport'
WHERE t.type = 'TAKEOFF'
  AND (t.meta->>'velocity' ~ '^[0-9]+(\.[0-9]+)?$')
  AND (t.meta->>'velocity')::float > 80
  AND NOT EXISTS (
      SELECT 1 FROM flights f
      WHERE f.aircraft_id = t.aircraft_id
        AND f.departure_time = t.ts
  )
ORDER BY t.ts ASC;


-- =============================================================================
-- DONE
-- Tables:     aircraft | positions | events | airports | flights | unknown_airport_candidates
-- Indexes:    covering all query patterns in db.py / analytics.py / forecast.py
-- RLS:        enabled on all tables | anon blocked | postgres/service_role bypass
-- Seed data:  246 airports (AR/UY/PY/BO/BR/CL/PE/EC/US)
-- Backfill:   flights populated from existing events (idempotent)
-- =============================================================================
