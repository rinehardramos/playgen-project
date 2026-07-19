-- template_slots.required_category_id blocked category deletion (and station
-- deletion via the categories cascade) whenever slots still referenced a
-- category — including the auto-seeded default template, whose fire-and-forget
-- seeding could land slots mid-delete. Slots are meaningless without their
-- category, so cascade instead.
ALTER TABLE template_slots
  DROP CONSTRAINT template_slots_required_category_id_fkey;

ALTER TABLE template_slots
  ADD CONSTRAINT template_slots_required_category_id_fkey
    FOREIGN KEY (required_category_id) REFERENCES categories(id) ON DELETE CASCADE;
