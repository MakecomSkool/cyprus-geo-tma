-- Auto-categorize Wikimapia places by name keywords
UPDATE places SET category = CASE
  WHEN name ILIKE '%park%' OR name ILIKE '%garden%' OR name ILIKE '%forest%' OR name ILIKE '%grove%' THEN 'park'
  WHEN name ILIKE '%beach%' OR name ILIKE '%bay%' OR name ILIKE '%coast%' OR name ILIKE '%cove%' OR name ILIKE '%cape%' THEN 'beach'
  WHEN name ILIKE '%hotel%' OR name ILIKE '%resort%' OR name ILIKE '%hostel%' OR name ILIKE '%apartment%' OR name ILIKE '%villa%' THEN 'hotel'
  WHEN name ILIKE '%restaurant%' OR name ILIKE '%tavern%' OR name ILIKE '%cafe%' OR name ILIKE '%coffee%' OR name ILIKE '%pizza%' OR name ILIKE '%grill%' THEN 'food'
  WHEN name ILIKE '%church%' OR name ILIKE '%monastery%' OR name ILIKE '%mosque%' OR name ILIKE '%chapel%' OR name ILIKE '%temple%' OR name ILIKE '%saint%' OR name ILIKE '%agios%' OR name ILIKE '%agia%' OR name ILIKE '%ayios%' THEN 'religious'
  WHEN name ILIKE '%school%' OR name ILIKE '%university%' OR name ILIKE '%college%' OR name ILIKE '%lyceum%' OR name ILIKE '%gymnasium%' OR name ILIKE '%ilkokul%' THEN 'education'
  WHEN name ILIKE '%hospital%' OR name ILIKE '%clinic%' OR name ILIKE '%pharmacy%' OR name ILIKE '%medical%' THEN 'healthcare'
  WHEN name ILIKE '%supermarket%' OR name ILIKE '%market%' OR name ILIKE '%shop%' OR name ILIKE '%store%' OR name ILIKE '%mall%' THEN 'shopping'
  WHEN name ILIKE '%road%' OR name ILIKE '%street%' OR name ILIKE '%avenue%' OR name ILIKE '%highway%' OR name ILIKE '%runway%' THEN 'road'
  WHEN name ILIKE '%municipality%' OR name ILIKE '%district%' OR name ILIKE '%area%' OR name ILIKE '%region%' OR name ILIKE '%village%' OR name ILIKE '%town%' OR name ILIKE '%peninsula%' THEN 'district'
  WHEN name ILIKE '%stadium%' OR name ILIKE '%sport%' OR name ILIKE '%gym%' OR name ILIKE '%pool%' OR name ILIKE '%tennis%' OR name ILIKE '%football%' THEN 'sport'
  WHEN name ILIKE '%car park%' OR name ILIKE '%parking%' THEN 'parking'
  WHEN name ILIKE '%airport%' OR name ILIKE '%terminal%' OR name ILIKE '%harbour%' OR name ILIKE '%harbor%' OR name ILIKE '%port%' THEN 'transport'
  WHEN name ILIKE '%base%' OR name ILIKE '%military%' OR name ILIKE '%barracks%' OR name ILIKE '%sovereign%' THEN 'military'
  ELSE 'wikimapia'
END
WHERE category = 'wikimapia';

-- Show results
SELECT category, COUNT(*) as count 
FROM places 
GROUP BY category 
ORDER BY count DESC;
