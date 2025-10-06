-- For status filtering
CREATE INDEX IF NOT EXISTS bill_status_idx ON public."Bill" ("currentStatus");

-- For congress filtering
CREATE INDEX IF NOT EXISTS bill_congress_idx ON public."Bill" ("congress");

-- For (status, congress) compound (optional if common together)
CREATE INDEX IF NOT EXISTS bill_status_congress_idx ON public."Bill" ("currentStatus","congress");

-- For category slug filtering: ensure index on slug
CREATE INDEX IF NOT EXISTS category_slug_idx ON public."Category"(slug);

-- Bridge table access pattern (bill -> categories)
CREATE INDEX IF NOT EXISTS bill_categories_bill_idx ON public."_BillCategories"("A");
-- (You already join on bc.\"A\" = b.id; ensure that direction is covered.)

-- Sort support (if not already):
CREATE INDEX IF NOT EXISTS bill_introduced_id_idx ON public."Bill" ("introducedDate","id");
CREATE INDEX IF NOT EXISTS bill_updated_id_idx ON public."Bill" ("updatedAt","id");
CREATE INDEX IF NOT EXISTS bill_statusDate_id_idx ON public."Bill" ("statusDate","id");

-- Trigram for search (after pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS bill_title_trgm_idx ON public."Bill" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bill_official_title_trgm_idx ON public."Bill" USING gin ("officialTitle" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bill_short_title_trgm_idx ON public."Bill" USING gin ("shortTitle" gin_trgm_ops);