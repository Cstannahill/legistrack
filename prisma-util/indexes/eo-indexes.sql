CREATE INDEX IF NOT EXISTS eo_signingDate_id_idx ON public."ExecutiveOrder" ("signingDate","id");
CREATE INDEX IF NOT EXISTS eo_publicationDate_id_idx ON public."ExecutiveOrder" ("publicationDate","id");
CREATE INDEX IF NOT EXISTS eo_updatedAt_id_idx ON public."ExecutiveOrder" ("updatedAt","id");
CREATE INDEX IF NOT EXISTS eo_president_trgm_idx ON public."ExecutiveOrder" USING gin ("presidentName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS eo_title_trgm_idx ON public."ExecutiveOrder" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS eo_category_bridge_idx ON public."_ExecutiveOrderCategories"("B", "A");