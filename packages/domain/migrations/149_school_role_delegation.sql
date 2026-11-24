-- Distinguish a school's own delegations from existing platform appointments.
ALTER TABLE school_administrators ADD COLUMN delegated_by_school boolean NOT NULL DEFAULT false;
