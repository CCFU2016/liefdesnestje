-- Visit date becomes optional and flexible: 'YYYY', 'YYYY-MM', 'YYYY-MM-DD',
-- or NULL for "don't remember".
ALTER TABLE "visited_places" ALTER COLUMN "visited_on" DROP NOT NULL;
