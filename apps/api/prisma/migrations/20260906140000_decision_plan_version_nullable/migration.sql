-- An undetermined decision may never have reached the plan: the enrollment source was silent, or
-- the stored configuration did not parse. Recording a version we never read would be a fiction, so
-- the column becomes nullable rather than carrying a placeholder.
ALTER TABLE "EligibilityDecision" ALTER COLUMN "planConfigVersion" DROP NOT NULL;
