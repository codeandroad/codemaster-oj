-- School names are managed by each school's administrators. Keep the historic
-- name column for existing platform tools; do not manufacture translations.
ALTER TABLE schools
  ADD COLUMN name_zh text NOT NULL DEFAULT '',
  ADD COLUMN name_en text NOT NULL DEFAULT '',
  ADD COLUMN settings_revision integer NOT NULL DEFAULT 1 CHECK (settings_revision > 0);

UPDATE schools SET
  name_zh = CASE WHEN name ~ '[㐀-鿿]' THEN btrim(name) ELSE '' END,
  name_en = CASE WHEN name ~ '[㐀-鿿]' THEN '' ELSE btrim(name) END;

ALTER TABLE schools
  ADD CONSTRAINT school_names_length CHECK (
    name_zh = btrim(name_zh) AND name_en = btrim(name_en)
    AND char_length(name_zh) <= 100 AND char_length(name_en) <= 100
    AND (name_zh <> '' OR name_en <> '')
  );

CREATE FUNCTION maintain_school_names() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.name_zh = '' AND NEW.name_en = '' THEN
      IF NEW.name ~ '[㐀-鿿]' THEN NEW.name_zh := btrim(NEW.name);
      ELSE NEW.name_en := btrim(NEW.name); END IF;
    ELSE
      NEW.name := coalesce(nullif(NEW.name_zh, ''), NEW.name_en);
    END IF;
    NEW.settings_revision := 1;
  ELSE
    IF NEW.name IS DISTINCT FROM OLD.name
      AND NEW.name_zh IS NOT DISTINCT FROM OLD.name_zh
      AND NEW.name_en IS NOT DISTINCT FROM OLD.name_en THEN
      -- Existing name-only platform and legacy settings updates remain valid.
      IF NEW.name ~ '[㐀-鿿]' THEN NEW.name_zh := btrim(NEW.name);
      ELSE NEW.name_en := btrim(NEW.name); END IF;
    ELSIF NEW.name_zh IS DISTINCT FROM OLD.name_zh OR NEW.name_en IS DISTINCT FROM OLD.name_en THEN
      NEW.name := coalesce(nullif(NEW.name_zh, ''), NEW.name_en);
    END IF;
    IF ROW(NEW.name, NEW.name_zh, NEW.name_en) IS DISTINCT FROM ROW(OLD.name, OLD.name_zh, OLD.name_en) THEN
      NEW.settings_revision := OLD.settings_revision + 1;
    ELSE
      NEW.settings_revision := OLD.settings_revision;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER school_names_compatibility BEFORE INSERT OR UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION maintain_school_names();
REVOKE ALL ON FUNCTION maintain_school_names() FROM PUBLIC;
