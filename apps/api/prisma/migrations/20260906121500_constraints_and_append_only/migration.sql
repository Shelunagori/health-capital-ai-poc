-- Integrity rules and append-only enforcement that the Prisma schema language cannot express.
--
-- Two kinds of rule live here:
--   1. Check constraints for invariants that are cheap, stable and always true of the data.
--   2. Triggers that make EligibilityDecision and AuditEvent append-only in the database itself,
--      so immutability does not depend on application code or ORM discipline.
--
-- Invariants that depend on business context (for example which enrollment applies to a service
-- date, or whether an adjustment should offset a specific debit) are deliberately left to
-- application policy in later milestones: encoding them here would be brittle and would duplicate
-- the deterministic rules engine.

-- A plan year is a forward-going interval.
ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_planYear_check" CHECK ("planYearEnd" > "planYearStart"),
  ADD CONSTRAINT "Plan_planConfigVersion_check" CHECK ("planConfigVersion" >= 1);

-- Enrollment windows are forward-going, and a terminated enrollment must say when it ended.
ALTER TABLE "BenefitEnrollment"
  ADD CONSTRAINT "BenefitEnrollment_effectiveRange_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "BenefitEnrollment_terminated_requires_end_check"
    CHECK ("status" <> 'TERMINATED' OR "effectiveTo" IS NOT NULL);

-- Money is a positive magnitude; the entry type carries the direction.
-- A debit must name its benefit category so year-to-date category spend is always computable.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_positive_check" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "LedgerEntry_debit_requires_category_check"
    CHECK ("type" <> 'DEBIT' OR "benefitCategory" IS NOT NULL);

ALTER TABLE "CareRequest"
  ADD CONSTRAINT "CareRequest_amount_positive_check" CHECK ("expenseAmountCents" > 0);

ALTER TABLE "EligibilityDecision"
  ADD CONSTRAINT "EligibilityDecision_coveredAmount_check"
    CHECK ("coveredAmountCents" IS NULL OR "coveredAmountCents" >= 0),
  -- An undetermined outcome has no covered amount; every decided outcome has one.
  ADD CONSTRAINT "EligibilityDecision_undetermined_has_no_amount_check"
    CHECK (
      ("outcome" = 'UNDETERMINED' AND "coveredAmountCents" IS NULL)
      OR ("outcome" <> 'UNDETERMINED' AND "coveredAmountCents" IS NOT NULL)
    );

-- Exactly one scope reference per role: members carry a member, employer admins carry an employer,
-- support carries neither. This mirrors the authorization model without encoding policy in the schema.
ALTER TABLE "User"
  ADD CONSTRAINT "User_role_scope_check"
    CHECK (
      ("role" = 'MEMBER' AND "memberId" IS NOT NULL AND "employerId" IS NULL)
      OR ("role" = 'EMPLOYER_ADMIN' AND "employerId" IS NOT NULL AND "memberId" IS NULL)
      OR ("role" = 'SUPPORT' AND "memberId" IS NULL AND "employerId" IS NULL)
    );

-- Support privileged reads must carry a constrained case reference when one is recorded.
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_caseRef_format_check"
    CHECK ("caseRef" IS NULL OR "caseRef" ~ '^[A-Z]{2,6}-[0-9]{1,8}$');

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION reject_row_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '0A000';
END;
$$;

COMMENT ON FUNCTION reject_row_mutation() IS
  'Blocks UPDATE and DELETE on append-only tables (eligibility decisions and audit events).';

CREATE TRIGGER "EligibilityDecision_append_only"
  BEFORE UPDATE OR DELETE ON "EligibilityDecision"
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
