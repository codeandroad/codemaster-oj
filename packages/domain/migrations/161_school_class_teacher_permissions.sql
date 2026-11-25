ALTER TABLE school_class_roster
  ADD COLUMN can_rename boolean NOT NULL DEFAULT false,
  ADD COLUMN can_manage_students boolean NOT NULL DEFAULT true;
GRANT UPDATE(can_rename,can_manage_students) ON school_class_roster TO campus_app;
