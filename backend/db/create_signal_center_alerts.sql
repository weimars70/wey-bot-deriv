BEGIN;

CREATE TABLE IF NOT EXISTS "signal_center_alerts" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "type" varchar(60) NOT NULL,
  "symbol" varchar(30),
  "title" varchar(180) NOT NULL,
  "message" text NOT NULL,
  "speechText" text,
  "targetPath" varchar(100) NOT NULL DEFAULT '/dashboard',
  "routeQuery" jsonb,
  "severity" varchar(20) NOT NULL DEFAULT 'warning',
  "dedupeKey" varchar(255) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_signal_center_alerts_dedupe"
  ON "signal_center_alerts" ("dedupeKey");

CREATE INDEX IF NOT EXISTS "IDX_signal_center_alerts_created_at"
  ON "signal_center_alerts" ("createdAt" DESC);

COMMIT;
