-- CreateEnum
CREATE TYPE "BenefitCategory" AS ENUM ('PHYSICAL_THERAPY', 'DENTAL', 'VISION', 'MENTAL_HEALTH', 'PRESCRIPTION', 'COSMETIC', 'GYM_MEMBERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CONTRIBUTION', 'DEBIT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'EMPLOYER_ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "EligibilityOutcome" AS ENUM ('ELIGIBLE', 'PARTIALLY_ELIGIBLE', 'INELIGIBLE', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "DecisionAuthority" AS ENUM ('RULES_ENGINE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGIN_FAILED', 'AUTHZ_DENIED', 'PRIVILEGED_READ', 'ELIGIBILITY_EVALUATED', 'ADAPTER_CALLED', 'AI_CALL', 'TOOL_CALL', 'AI_GUARD_TRIGGERED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('ALLOW', 'DENY', 'SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "SupportReasonCode" AS ENUM ('MEMBER_SUPPORT_TICKET', 'BENEFITS_DISPUTE', 'DATA_QUALITY_INVESTIGATION', 'FRAUD_REVIEW', 'REGULATORY_REQUEST');

-- CreateTable
CREATE TABLE "Employer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "employerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "planYearStart" DATE NOT NULL,
    "planYearEnd" DATE NOT NULL,
    "coverageRules" JSONB NOT NULL,
    "planConfigVersion" INTEGER NOT NULL DEFAULT 1,
    "planConfigAsOf" TIMESTAMP(3) NOT NULL,
    "planExternalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "externalRef" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitEnrollment" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "employerId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "enrollmentExternalRef" TEXT NOT NULL,
    "sourceAsOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCapitalAccount" (
    "id" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "cardExternalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCapitalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "benefitCategory" "BenefitCategory",
    "careRequestId" UUID,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "memberId" UUID,
    "employerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareRequest" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "treatmentCategory" "BenefitCategory" NOT NULL,
    "expenseAmountCents" INTEGER NOT NULL,
    "serviceDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityDecision" (
    "id" UUID NOT NULL,
    "careRequestId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "outcome" "EligibilityOutcome" NOT NULL,
    "coveredAmountCents" INTEGER,
    "reasons" JSONB NOT NULL,
    "conditions" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "planConfigVersion" INTEGER NOT NULL,
    "inputsSnapshot" JSONB NOT NULL,
    "decidedBy" "DecisionAuthority" NOT NULL DEFAULT 'RULES_ENGINE',
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traceId" TEXT NOT NULL,
    "actorUserId" UUID,
    "actorRole" "UserRole",
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT,
    "resourceId" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "engineVersion" TEXT,
    "planConfigVersion" INTEGER,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "promptTemplateId" TEXT,
    "promptVersion" TEXT,
    "reasonCode" "SupportReasonCode",
    "caseRef" TEXT,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employer_externalRef_key" ON "Employer"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_planExternalRef_key" ON "Plan"("planExternalRef");

-- CreateIndex
CREATE INDEX "Plan_employerId_idx" ON "Plan"("employerId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_externalRef_key" ON "Member"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitEnrollment_enrollmentExternalRef_key" ON "BenefitEnrollment"("enrollmentExternalRef");

-- CreateIndex
CREATE INDEX "BenefitEnrollment_memberId_effectiveFrom_idx" ON "BenefitEnrollment"("memberId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "BenefitEnrollment_planId_idx" ON "BenefitEnrollment"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitEnrollment_employerId_employeeId_key" ON "BenefitEnrollment"("employerId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthCapitalAccount_enrollmentId_key" ON "HealthCapitalAccount"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthCapitalAccount_cardExternalRef_key" ON "HealthCapitalAccount"("cardExternalRef");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_occurredAt_idx" ON "LedgerEntry"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_benefitCategory_occurredAt_idx" ON "LedgerEntry"("accountId", "benefitCategory", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");

-- CreateIndex
CREATE INDEX "User_employerId_idx" ON "User"("employerId");

-- CreateIndex
CREATE INDEX "CareRequest_memberId_serviceDate_idx" ON "CareRequest"("memberId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityDecision_careRequestId_key" ON "EligibilityDecision"("careRequestId");

-- CreateIndex
CREATE INDEX "EligibilityDecision_memberId_evaluatedAt_idx" ON "EligibilityDecision"("memberId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_traceId_idx" ON "AuditEvent"("traceId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_occurredAt_idx" ON "AuditEvent"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx" ON "AuditEvent"("actorUserId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitEnrollment" ADD CONSTRAINT "BenefitEnrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCapitalAccount" ADD CONSTRAINT "HealthCapitalAccount_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "BenefitEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "HealthCapitalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRequest" ADD CONSTRAINT "CareRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRequest" ADD CONSTRAINT "CareRequest_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "BenefitEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityDecision" ADD CONSTRAINT "EligibilityDecision_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityDecision" ADD CONSTRAINT "EligibilityDecision_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityDecision" ADD CONSTRAINT "EligibilityDecision_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "BenefitEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
