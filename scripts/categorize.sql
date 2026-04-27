UPDATE places SET category = CASE
  WHEN name ~* '(park|garden|forest|wood|grove|square|plaza|skvep|skver)' THEN 'park'
  WHEN name ~* '(beach|bay|coast|sea|shore|marina|agia napa|Fig Tree|Nissi|Coral)' THEN 'beach'
  WHEN name ~* '(hotel|resort|hostel|villa|inn|lodge|suites|apartments|pension)' THEN 'hotel'
  WHEN name ~* '(restaurant|cafe|tavern|bar|pub|grill|pizza|souvlaki|meze|kitchen|bakery|coffee|snack|fast.?food|takeaway)' THEN 'food'
  WHEN name ~* '(church|chapel|monastery|mosque|temple|cathedral|saint|agios|agia|ayios|ayia|orthodox|synagogue|shrine|chapel)' THEN 'religious'
  WHEN name ~* '(school|university|college|institute|academy|lyceum|gymnasium|kindergarten|nursery)' THEN 'education'
  WHEN name ~* '(hospital|clinic|medical|pharmacy|doctor|health|dental|polyclinic|dispensary|laboratory)' THEN 'healthcare'
  WHEN name ~* '(mall|market|shop|store|supermarket|centre|plaza|emporium|boutique|hypermarket|lidl|alfamega|alphamega|sklavenitis|carrefour)' THEN 'shopping'
  WHEN name ~* '(district|quarter|area|zone|neighbourhood|neighborhood|region|suburb|village|community|municipality|agros|polis|chorio)' THEN 'district'
  WHEN name ~* '(stadium|sport|gym|swimming|pool|tennis|football|basketball|golf|athletic|fitness|recreation)' THEN 'sport'
  WHEN name ~* '(parking|garage|car.?park|car park)' THEN 'parking'
  WHEN name ~* '(airport|port|station|terminal|bus|highway|motorway|interchange)' THEN 'transport'
  WHEN name ~* '(military|army|base|barracks|navy|police|fire.?station|camp)' THEN 'military'
  ELSE 'wikimapia'
END
WHERE category = 'wikimapia' OR category IS NULL;

SELECT category, COUNT(*) as cnt FROM places GROUP BY category ORDER BY cnt DESC;
