CREATE TABLE participants (
    pda TEXT PRIMARY KEY,
    authority TEXT NOT NULL UNIQUE,
    user_name TEXT NOT NULL
);

CREATE INDEX idx_participants_user_name ON participants(user_name);
