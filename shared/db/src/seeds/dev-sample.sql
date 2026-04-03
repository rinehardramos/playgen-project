-- Dev sample seed: categories, songs, and templates for Test Station
-- Idempotent — safe to run multiple times (uses ON CONFLICT DO NOTHING / DO UPDATE)
-- Station: 8edb1148-3423-43c7-9ffb-065aabdb3dfd (Test Station)
-- Company: 00000000-0000-0000-0000-000000000001 (PlayGen Radio)

DO $$
DECLARE
  sid UUID := '8edb1148-3423-43c7-9ffb-065aabdb3dfd';
  cid UUID := '00000000-0000-0000-0000-000000000001';

  cat_fgs  UUID;
  cat_fgf  UUID;
  cat_pgs  UUID;
  cat_pgf  UUID;
  cat_jbx  UUID;
  cat_70s  UUID;
  cat_80s  UUID;
  cat_90s  UUID;
  cat_c1   UUID;
  cat_c2   UUID;
  cat_y1   UUID;
  cat_y2   UUID;

  tpl_id   UUID;
  tpl2_id  UUID;
  song_id  UUID;
BEGIN

  -- ── Categories ─────────────────────────────────────────────────────────────

  INSERT INTO categories (station_id, code, label, rotation_weight, color_tag)
  VALUES
    (sid, 'FGs',  'Foreign Golden Standards (Slow)',   1.0, '#7c3aed'),
    (sid, 'FGf',  'Foreign Golden Standards (Fast)',   1.0, '#2563eb'),
    (sid, 'PGs',  'Philippine Golden Standards (Slow)',1.0, '#16a34a'),
    (sid, 'PGf',  'Philippine Golden Standards (Fast)',1.0, '#ca8a04'),
    (sid, 'JBx',  'Jeepney Beat / OPM',               1.2, '#ea580c'),
    (sid, '7',    '70s Music',                         0.9, '#db2777'),
    (sid, '8',    '80s Music',                         0.9, '#0891b2'),
    (sid, '9',    '90s Music',                         0.9, '#65a30d'),
    (sid, 'c1',   'Contemporary (Pool 1)',             1.1, '#9333ea'),
    (sid, 'c2',   'Contemporary (Pool 2)',             1.1, '#3b82f6'),
    (sid, 'y1',   'Young Contemporary (Pool 1)',       1.2, '#f97316'),
    (sid, 'y2',   'Young Contemporary (Pool 2)',       1.2, '#14b8a6')
  ON CONFLICT (station_id, code) DO UPDATE SET label = EXCLUDED.label, color_tag = EXCLUDED.color_tag;

  SELECT id INTO cat_fgs FROM categories WHERE station_id = sid AND code = 'FGs';
  SELECT id INTO cat_fgf FROM categories WHERE station_id = sid AND code = 'FGf';
  SELECT id INTO cat_pgs FROM categories WHERE station_id = sid AND code = 'PGs';
  SELECT id INTO cat_pgf FROM categories WHERE station_id = sid AND code = 'PGf';
  SELECT id INTO cat_jbx FROM categories WHERE station_id = sid AND code = 'JBx';
  SELECT id INTO cat_70s FROM categories WHERE station_id = sid AND code = '7';
  SELECT id INTO cat_80s FROM categories WHERE station_id = sid AND code = '8';
  SELECT id INTO cat_90s FROM categories WHERE station_id = sid AND code = '9';
  SELECT id INTO cat_c1  FROM categories WHERE station_id = sid AND code = 'c1';
  SELECT id INTO cat_c2  FROM categories WHERE station_id = sid AND code = 'c2';
  SELECT id INTO cat_y1  FROM categories WHERE station_id = sid AND code = 'y1';
  SELECT id INTO cat_y2  FROM categories WHERE station_id = sid AND code = 'y2';

  -- ── Songs: Foreign Golden Standards (Slow) ─────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_fgs, 'Fly Me to the Moon',       'Frank Sinatra'),
    (cid, sid, cat_fgs, 'The Way You Look Tonight',  'Frank Sinatra'),
    (cid, sid, cat_fgs, 'Unforgettable',             'Nat King Cole'),
    (cid, sid, cat_fgs, 'Mona Lisa',                 'Nat King Cole'),
    (cid, sid, cat_fgs, 'Misty',                     'Ella Fitzgerald'),
    (cid, sid, cat_fgs, 'Someone to Watch Over Me',  'Ella Fitzgerald'),
    (cid, sid, cat_fgs, 'At Last',                   'Etta James'),
    (cid, sid, cat_fgs, 'The Shadow of Your Smile',  'Tony Bennett'),
    (cid, sid, cat_fgs, 'When I Fall in Love',       'Nat King Cole'),
    (cid, sid, cat_fgs, 'Unchained Melody',          'The Righteous Brothers')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Foreign Golden Standards (Fast) ─────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_fgf, 'That''s Life',              'Frank Sinatra'),
    (cid, sid, cat_fgf, 'New York New York',         'Frank Sinatra'),
    (cid, sid, cat_fgf, 'Everybody Loves Somebody', 'Dean Martin'),
    (cid, sid, cat_fgf, 'That''s Amore',             'Dean Martin'),
    (cid, sid, cat_fgf, 'Mr. Bojangles',             'Sammy Davis Jr.'),
    (cid, sid, cat_fgf, 'Candy Man',                 'Sammy Davis Jr.'),
    (cid, sid, cat_fgf, 'Come Fly with Me',          'Frank Sinatra'),
    (cid, sid, cat_fgf, 'Sway',                      'Dean Martin')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Philippine Golden Standards (Slow) ──────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_pgs, 'Ikaw',                      'Yeng Constantino'),
    (cid, sid, cat_pgs, 'Hanggang',                  'Wency Cornejo'),
    (cid, sid, cat_pgs, 'Kahit Maputi Na Ang Buhok Ko', 'Rey Valera'),
    (cid, sid, cat_pgs, 'Ikaw Ang Lahat Sa Akin',    'Martin Nievera'),
    (cid, sid, cat_pgs, 'Kailangan Ko''y Ikaw',      'Basil Valdez'),
    (cid, sid, cat_pgs, 'Nandito Ako',               'Ogie Alcasid'),
    (cid, sid, cat_pgs, 'Mahal Ko O Mahal Ako',      'Jaya'),
    (cid, sid, cat_pgs, 'Tuloy Pa Rin',              'Neocolors'),
    (cid, sid, cat_pgs, 'Bato sa Buhangin',          'Imelda Papin'),
    (cid, sid, cat_pgs, 'Pangarap Ko Ang Ibigin Ka', 'Imelda Papin')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Philippine Golden Standards (Fast) ──────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_pgf, 'Kumakaway ang Palad Ko',    'Freddie Aguilar'),
    (cid, sid, cat_pgf, 'Anak',                      'Freddie Aguilar'),
    (cid, sid, cat_pgf, 'Kay Ganda ng Ating Musika', 'VST and Company'),
    (cid, sid, cat_pgf, 'Awitin Mo at Isasayaw Ko',  'VST and Company'),
    (cid, sid, cat_pgf, 'Annie Batungbakal',         'VST and Company'),
    (cid, sid, cat_pgf, 'Manila',                    'Hotdog'),
    (cid, sid, cat_pgf, 'Eh Kasi Bata',              'Hotdog')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Jeepney Beat / OPM ──────────────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_jbx, 'Tadhana',                   'Up Dharma Down'),
    (cid, sid, cat_jbx, 'Paraluman',                 'Adie'),
    (cid, sid, cat_jbx, 'Dati',                      'Sam Concepcion'),
    (cid, sid, cat_jbx, 'Muli',                      'December Avenue'),
    (cid, sid, cat_jbx, 'Sa Ngalan ng Pag-ibig',     'December Avenue'),
    (cid, sid, cat_jbx, 'Ere',                       'Chico and the Gypsies'),
    (cid, sid, cat_jbx, 'Sana',                      'I Belong to the Zoo'),
    (cid, sid, cat_jbx, 'Buwan',                     'Juan Karlos')
  ON CONFLICT DO NOTHING;

  -- ── Songs: 70s Music ───────────────────────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_70s, 'Hotel California',           'Eagles'),
    (cid, sid, cat_70s, 'More Than a Feeling',        'Boston'),
    (cid, sid, cat_70s, 'Dream On',                   'Aerosmith'),
    (cid, sid, cat_70s, 'Bohemian Rhapsody',          'Queen'),
    (cid, sid, cat_70s, 'Don''t Stop Me Now',         'Queen'),
    (cid, sid, cat_70s, 'Stayin'' Alive',             'Bee Gees'),
    (cid, sid, cat_70s, 'How Deep Is Your Love',      'Bee Gees'),
    (cid, sid, cat_70s, 'Rocket Man',                 'Elton John'),
    (cid, sid, cat_70s, 'Crocodile Rock',             'Elton John'),
    (cid, sid, cat_70s, 'Dancing Queen',              'ABBA')
  ON CONFLICT DO NOTHING;

  -- ── Songs: 80s Music ───────────────────────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_80s, 'Take On Me',                 'a-ha'),
    (cid, sid, cat_80s, 'Sweet Child O'' Mine',       'Guns N'' Roses'),
    (cid, sid, cat_80s, 'Every Breath You Take',      'The Police'),
    (cid, sid, cat_80s, 'Don''t You (Forget About Me)','Simple Minds'),
    (cid, sid, cat_80s, 'Africa',                     'Toto'),
    (cid, sid, cat_80s, 'Come On Eileen',             'Dexys Midnight Runners'),
    (cid, sid, cat_80s, 'Girls Just Want to Have Fun','Cyndi Lauper'),
    (cid, sid, cat_80s, 'Like a Prayer',              'Madonna'),
    (cid, sid, cat_80s, 'Careless Whisper',           'George Michael'),
    (cid, sid, cat_80s, 'Don''t Stop Believin''',     'Journey')
  ON CONFLICT DO NOTHING;

  -- ── Songs: 90s Music ───────────────────────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_90s, 'Wonderwall',                 'Oasis'),
    (cid, sid, cat_90s, 'Losing My Religion',         'R.E.M.'),
    (cid, sid, cat_90s, 'Black Hole Sun',             'Soundgarden'),
    (cid, sid, cat_90s, 'Smells Like Teen Spirit',    'Nirvana'),
    (cid, sid, cat_90s, 'Waterfalls',                 'TLC'),
    (cid, sid, cat_90s, 'One Sweet Day',              'Mariah Carey & Boyz II Men'),
    (cid, sid, cat_90s, 'I Will Always Love You',     'Whitney Houston'),
    (cid, sid, cat_90s, 'Un-Break My Heart',          'Toni Braxton'),
    (cid, sid, cat_90s, 'Return of the Mack',        'Mark Morrison'),
    (cid, sid, cat_90s, 'Mambo No. 5',               'Lou Bega')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Contemporary Pool 1 ─────────────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_c1,  'Blinding Lights',            'The Weeknd'),
    (cid, sid, cat_c1,  'Shape of You',               'Ed Sheeran'),
    (cid, sid, cat_c1,  'Perfect',                    'Ed Sheeran'),
    (cid, sid, cat_c1,  'Someone You Loved',          'Lewis Capaldi'),
    (cid, sid, cat_c1,  'Stay With Me',               'Sam Smith'),
    (cid, sid, cat_c1,  'Rolling in the Deep',        'Adele'),
    (cid, sid, cat_c1,  'Hello',                      'Adele'),
    (cid, sid, cat_c1,  'All of Me',                  'John Legend'),
    (cid, sid, cat_c1,  'A Thousand Years',           'Christina Perri'),
    (cid, sid, cat_c1,  'Thinking Out Loud',          'Ed Sheeran')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Contemporary Pool 2 ─────────────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_c2,  'Anti-Hero',                  'Taylor Swift'),
    (cid, sid, cat_c2,  'As It Was',                  'Harry Styles'),
    (cid, sid, cat_c2,  'Levitating',                 'Dua Lipa'),
    (cid, sid, cat_c2,  'Bad Guy',                    'Billie Eilish'),
    (cid, sid, cat_c2,  'Happier Than Ever',          'Billie Eilish'),
    (cid, sid, cat_c2,  'Industry Baby',              'Lil Nas X'),
    (cid, sid, cat_c2,  'Peaches',                    'Justin Bieber'),
    (cid, sid, cat_c2,  'Save Your Tears',            'The Weeknd'),
    (cid, sid, cat_c2,  'Watermelon Sugar',           'Harry Styles'),
    (cid, sid, cat_c2,  'drivers license',            'Olivia Rodrigo')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Young Contemporary Pool 1 ──────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_y1,  'Flowers',                    'Miley Cyrus'),
    (cid, sid, cat_y1,  'Unholy',                     'Sam Smith & Kim Petras'),
    (cid, sid, cat_y1,  'Cruel Summer',               'Taylor Swift'),
    (cid, sid, cat_y1,  'Shake It Off',               'Taylor Swift'),
    (cid, sid, cat_y1,  'Dynamite',                   'BTS'),
    (cid, sid, cat_y1,  'Butter',                     'BTS'),
    (cid, sid, cat_y1,  'Kill Bill',                  'SZA'),
    (cid, sid, cat_y1,  'Die For You',                'The Weeknd'),
    (cid, sid, cat_y1,  'Calm Down',                  'Rema & Selena Gomez'),
    (cid, sid, cat_y1,  'Essence',                    'Wizkid & Tems')
  ON CONFLICT DO NOTHING;

  -- ── Songs: Young Contemporary Pool 2 ──────────────────────────────────────
  INSERT INTO songs (company_id, station_id, category_id, title, artist) VALUES
    (cid, sid, cat_y2,  'Cupid',                      'FIFTY FIFTY'),
    (cid, sid, cat_y2,  'Vampire',                    'Olivia Rodrigo'),
    (cid, sid, cat_y2,  'Escapism',                   'RAYE & 070 Shake'),
    (cid, sid, cat_y2,  'Boy''s a Liar Pt. 2',        'PinkPantheress & Ice Spice'),
    (cid, sid, cat_y2,  'Ella Baila Sola',            'Eslabon Armado & Peso Pluma'),
    (cid, sid, cat_y2,  'Rich Flex',                  'Drake & 21 Savage'),
    (cid, sid, cat_y2,  'Snooze',                     'SZA'),
    (cid, sid, cat_y2,  'Creepin''',                  'Metro Boomin & The Weeknd')
  ON CONFLICT DO NOTHING;

  -- ── Eligible hours for songs ───────────────────────────────────────────────
  -- Golden standards: all hours
  INSERT INTO song_slots (song_id, eligible_hour)
  SELECT s.id, h.hour FROM songs s
  CROSS JOIN generate_series(0, 23) AS h(hour)
  WHERE s.station_id = sid AND s.category_id IN (cat_fgs, cat_fgf, cat_pgs, cat_pgf)
  ON CONFLICT DO NOTHING;

  -- OPM/Jeepney: daytime 6-22
  INSERT INTO song_slots (song_id, eligible_hour)
  SELECT s.id, h.hour FROM songs s
  CROSS JOIN generate_series(6, 22) AS h(hour)
  WHERE s.station_id = sid AND s.category_id IN (cat_jbx, cat_70s, cat_80s, cat_90s)
  ON CONFLICT DO NOTHING;

  -- Contemporary: daytime + evening 8-23
  INSERT INTO song_slots (song_id, eligible_hour)
  SELECT s.id, h.hour FROM songs s
  CROSS JOIN generate_series(8, 23) AS h(hour)
  WHERE s.station_id = sid AND s.category_id IN (cat_c1, cat_c2, cat_y1, cat_y2)
  ON CONFLICT DO NOTHING;

  -- ── Template 1: Weekday Standard (1_day, default) ─────────────────────────
  INSERT INTO templates (station_id, name, type, is_default)
  VALUES (sid, 'Weekday Standard', '1_day', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO tpl_id;

  IF tpl_id IS NULL THEN
    SELECT id INTO tpl_id FROM templates WHERE station_id = sid AND name = 'Weekday Standard';
  END IF;

  -- Slots: midnight-5 (overnight) → FGs/FGf rotation
  INSERT INTO template_slots (template_id, hour, position, required_category_id) VALUES
    (tpl_id, 0,  1, cat_fgs), (tpl_id, 0,  2, cat_fgf), (tpl_id, 0,  3, cat_80s), (tpl_id, 0,  4, cat_90s),
    (tpl_id, 1,  1, cat_fgs), (tpl_id, 1,  2, cat_fgf), (tpl_id, 1,  3, cat_pgs), (tpl_id, 1,  4, cat_80s),
    (tpl_id, 2,  1, cat_fgs), (tpl_id, 2,  2, cat_70s), (tpl_id, 2,  3, cat_pgs), (tpl_id, 2,  4, cat_80s),
    (tpl_id, 3,  1, cat_fgs), (tpl_id, 3,  2, cat_70s), (tpl_id, 3,  3, cat_pgs), (tpl_id, 3,  4, cat_90s),
    (tpl_id, 4,  1, cat_fgs), (tpl_id, 4,  2, cat_fgf), (tpl_id, 4,  3, cat_pgs), (tpl_id, 4,  4, cat_80s),
    (tpl_id, 5,  1, cat_fgs), (tpl_id, 5,  2, cat_fgf), (tpl_id, 5,  3, cat_pgs), (tpl_id, 5,  4, cat_80s),
    -- Morning 6-11
    (tpl_id, 6,  1, cat_c1),  (tpl_id, 6,  2, cat_jbx), (tpl_id, 6,  3, cat_pgs), (tpl_id, 6,  4, cat_80s),
    (tpl_id, 7,  1, cat_c1),  (tpl_id, 7,  2, cat_y1),  (tpl_id, 7,  3, cat_pgf), (tpl_id, 7,  4, cat_90s),
    (tpl_id, 8,  1, cat_c1),  (tpl_id, 8,  2, cat_y1),  (tpl_id, 8,  3, cat_jbx), (tpl_id, 8,  4, cat_c2),
    (tpl_id, 9,  1, cat_c1),  (tpl_id, 9,  2, cat_y1),  (tpl_id, 9,  3, cat_jbx), (tpl_id, 9,  4, cat_fgs),
    (tpl_id, 10, 1, cat_c1),  (tpl_id, 10, 2, cat_c2),  (tpl_id, 10, 3, cat_y1),  (tpl_id, 10, 4, cat_80s),
    (tpl_id, 11, 1, cat_c2),  (tpl_id, 11, 2, cat_y1),  (tpl_id, 11, 3, cat_jbx), (tpl_id, 11, 4, cat_pgs),
    -- Midday 12-17
    (tpl_id, 12, 1, cat_c1),  (tpl_id, 12, 2, cat_y1),  (tpl_id, 12, 3, cat_jbx), (tpl_id, 12, 4, cat_pgf),
    (tpl_id, 13, 1, cat_c2),  (tpl_id, 13, 2, cat_y2),  (tpl_id, 13, 3, cat_jbx), (tpl_id, 13, 4, cat_c1),
    (tpl_id, 14, 1, cat_c1),  (tpl_id, 14, 2, cat_y1),  (tpl_id, 14, 3, cat_90s), (tpl_id, 14, 4, cat_pgs),
    (tpl_id, 15, 1, cat_c2),  (tpl_id, 15, 2, cat_y2),  (tpl_id, 15, 3, cat_jbx), (tpl_id, 15, 4, cat_80s),
    (tpl_id, 16, 1, cat_c1),  (tpl_id, 16, 2, cat_y1),  (tpl_id, 16, 3, cat_fgf), (tpl_id, 16, 4, cat_pgf),
    (tpl_id, 17, 1, cat_c2),  (tpl_id, 17, 2, cat_y2),  (tpl_id, 17, 3, cat_jbx), (tpl_id, 17, 4, cat_90s),
    -- Evening 18-23
    (tpl_id, 18, 1, cat_c1),  (tpl_id, 18, 2, cat_y1),  (tpl_id, 18, 3, cat_fgs), (tpl_id, 18, 4, cat_pgs),
    (tpl_id, 19, 1, cat_c1),  (tpl_id, 19, 2, cat_y2),  (tpl_id, 19, 3, cat_jbx), (tpl_id, 19, 4, cat_80s),
    (tpl_id, 20, 1, cat_c1),  (tpl_id, 20, 2, cat_c2),  (tpl_id, 20, 3, cat_fgs), (tpl_id, 20, 4, cat_90s),
    (tpl_id, 21, 1, cat_c2),  (tpl_id, 21, 2, cat_y1),  (tpl_id, 21, 3, cat_pgs), (tpl_id, 21, 4, cat_70s),
    (tpl_id, 22, 1, cat_fgs), (tpl_id, 22, 2, cat_fgf), (tpl_id, 22, 3, cat_80s), (tpl_id, 22, 4, cat_c1),
    (tpl_id, 23, 1, cat_fgs), (tpl_id, 23, 2, cat_fgf), (tpl_id, 23, 3, cat_pgs), (tpl_id, 23, 4, cat_90s)
  ON CONFLICT (template_id, hour, position) DO NOTHING;

  -- ── Template 2: Weekend Hits (1_day) ──────────────────────────────────────
  INSERT INTO templates (station_id, name, type, is_default)
  VALUES (sid, 'Weekend Hits', '1_day', false)
  ON CONFLICT DO NOTHING
  RETURNING id INTO tpl2_id;

  IF tpl2_id IS NULL THEN
    SELECT id INTO tpl2_id FROM templates WHERE station_id = sid AND name = 'Weekend Hits';
  END IF;

  INSERT INTO template_slots (template_id, hour, position, required_category_id) VALUES
    (tpl2_id, 6,  1, cat_y1),  (tpl2_id, 6,  2, cat_y2),  (tpl2_id, 6,  3, cat_c1),  (tpl2_id, 6,  4, cat_jbx),
    (tpl2_id, 7,  1, cat_y1),  (tpl2_id, 7,  2, cat_y2),  (tpl2_id, 7,  3, cat_c2),  (tpl2_id, 7,  4, cat_pgf),
    (tpl2_id, 8,  1, cat_c1),  (tpl2_id, 8,  2, cat_y1),  (tpl2_id, 8,  3, cat_y2),  (tpl2_id, 8,  4, cat_80s),
    (tpl2_id, 9,  1, cat_c2),  (tpl2_id, 9,  2, cat_y2),  (tpl2_id, 9,  3, cat_jbx), (tpl2_id, 9,  4, cat_90s),
    (tpl2_id, 10, 1, cat_y1),  (tpl2_id, 10, 2, cat_c1),  (tpl2_id, 10, 3, cat_jbx), (tpl2_id, 10, 4, cat_pgf),
    (tpl2_id, 11, 1, cat_y2),  (tpl2_id, 11, 2, cat_c2),  (tpl2_id, 11, 3, cat_jbx), (tpl2_id, 11, 4, cat_pgs),
    (tpl2_id, 12, 1, cat_c1),  (tpl2_id, 12, 2, cat_y1),  (tpl2_id, 12, 3, cat_y2),  (tpl2_id, 12, 4, cat_jbx),
    (tpl2_id, 13, 1, cat_c2),  (tpl2_id, 13, 2, cat_y2),  (tpl2_id, 13, 3, cat_80s), (tpl2_id, 13, 4, cat_c1),
    (tpl2_id, 14, 1, cat_y1),  (tpl2_id, 14, 2, cat_c1),  (tpl2_id, 14, 3, cat_90s), (tpl2_id, 14, 4, cat_jbx),
    (tpl2_id, 15, 1, cat_c2),  (tpl2_id, 15, 2, cat_y2),  (tpl2_id, 15, 3, cat_jbx), (tpl2_id, 15, 4, cat_pgf),
    (tpl2_id, 16, 1, cat_y1),  (tpl2_id, 16, 2, cat_c1),  (tpl2_id, 16, 3, cat_fgf), (tpl2_id, 16, 4, cat_80s),
    (tpl2_id, 17, 1, cat_y2),  (tpl2_id, 17, 2, cat_c2),  (tpl2_id, 17, 3, cat_jbx), (tpl2_id, 17, 4, cat_90s),
    (tpl2_id, 18, 1, cat_c1),  (tpl2_id, 18, 2, cat_y1),  (tpl2_id, 18, 3, cat_fgs), (tpl2_id, 18, 4, cat_pgs),
    (tpl2_id, 19, 1, cat_y1),  (tpl2_id, 19, 2, cat_y2),  (tpl2_id, 19, 3, cat_jbx), (tpl2_id, 19, 4, cat_c1),
    (tpl2_id, 20, 1, cat_c2),  (tpl2_id, 20, 2, cat_y2),  (tpl2_id, 20, 3, cat_fgs), (tpl2_id, 20, 4, cat_c1),
    (tpl2_id, 21, 1, cat_y1),  (tpl2_id, 21, 2, cat_c1),  (tpl2_id, 21, 3, cat_pgs), (tpl2_id, 21, 4, cat_70s),
    (tpl2_id, 22, 1, cat_fgs), (tpl2_id, 22, 2, cat_fgf), (tpl2_id, 22, 3, cat_y1),  (tpl2_id, 22, 4, cat_c1),
    (tpl2_id, 23, 1, cat_fgs), (tpl2_id, 23, 2, cat_fgf), (tpl2_id, 23, 3, cat_pgs), (tpl2_id, 23, 4, cat_90s)
  ON CONFLICT (template_id, hour, position) DO NOTHING;

  RAISE NOTICE 'Seed complete.';
END $$;
