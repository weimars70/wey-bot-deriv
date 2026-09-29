ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "notificationGroup" varchar(20) DEFAULT 'ALL';