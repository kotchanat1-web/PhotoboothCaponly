-- DEC-018: payment verification server schema (D1 / SQLite)

-- one row per booth; the booth key itself is never stored, only its SHA-256 (ADM-7)
CREATE TABLE booths (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- price table lives on the server: the booth only says "qty", the server decides the amount (DEC-019)
CREATE TABLE prices (
  qty INTEGER PRIMARY KEY CHECK (qty >= 1),
  amount_satang INTEGER NOT NULL CHECK (amount_satang > 0)
);
-- BR-05 draft defaults: 1=130, 2=250, 3=375, 4=500 THB
INSERT INTO prices (qty, amount_satang) VALUES (1, 13000), (2, 25000), (3, 37500), (4, 50000);

-- status: creating → pending → successful | failed | expired | mismatch | error
--   successful = verified with Omise (status successful + paid + amount/currency/ids match)
--   mismatch   = Omise says something that does not match this row → never treated as paid
CREATE TABLE charges (
  id TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL REFERENCES booths(id),
  session_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  amount_satang INTEGER NOT NULL,
  currency TEXT NOT NULL,
  omise_charge_id TEXT UNIQUE,
  status TEXT NOT NULL,
  failure TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  paid_at TEXT,
  cancel_requested_at TEXT,
  claimed_at TEXT,
  last_checked_at TEXT
);
CREATE INDEX charges_status_created ON charges (status, created_at);
CREATE INDEX charges_booth ON charges (booth_id, created_at);

-- append-only audit trail of every money-related event
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  booth_id TEXT,
  charge_id TEXT,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX audit_charge ON audit (charge_id);
