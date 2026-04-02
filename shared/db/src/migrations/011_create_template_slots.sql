CREATE TABLE template_slots (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id          UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    hour                 SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
    position             SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 4),
    required_category_id UUID NOT NULL REFERENCES categories(id),
    UNIQUE(template_id, hour, position)
);
CREATE INDEX idx_template_slots_template ON template_slots(template_id);
