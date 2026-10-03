BEGIN;

ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "backtesting" boolean NOT NULL DEFAULT false;

ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "maxProfitUsd" double precision NOT NULL DEFAULT 0;

ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "hadSpike" boolean NOT NULL DEFAULT false;

ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "spikeCount" integer NOT NULL DEFAULT 0;

ALTER TABLE "watched_entry_levels"
  ADD COLUMN IF NOT EXISTS "backtesting" boolean NOT NULL DEFAULT false;

COMMIT;
