// SQLite schema (ported from database.sql). Money is stored as REAL and always rounded to 2 decimals
// by the API layer. Dates are 'YYYY-MM-DD' text.
export const SCHEMA = [
`CREATE TABLE IF NOT EXISTS interest_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, village TEXT NOT NULL, mobile TEXT NOT NULL,
    principal REAL NOT NULL, principal_balance REAL NOT NULL, rate_of_interest REAL NOT NULL,
    transaction_date TEXT NOT NULL, payment_type TEXT NOT NULL DEFAULT '100days',
    no_of_payments INTEGER DEFAULT 0, total_interest_collected REAL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS interest_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES interest_customers(id) ON DELETE CASCADE,
    collection_date TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS interest_principal_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES interest_customers(id) ON DELETE CASCADE,
    collection_date TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'partial',
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS borrower_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, village TEXT NOT NULL, mobile TEXT NOT NULL,
    principal REAL NOT NULL, balance REAL NOT NULL,
    transaction_date TEXT NOT NULL, payment_type TEXT NOT NULL,
    due_count INTEGER DEFAULT 0, day_count INTEGER DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS borrower_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES borrower_customers(id) ON DELETE CASCADE,
    collection_date TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS rent_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, village TEXT NOT NULL, mobile TEXT NOT NULL UNIQUE,
    rent_amount REAL NOT NULL, agreement_date TEXT NOT NULL,
    status TEXT DEFAULT 'pending', is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS rent_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES rent_customers(id) ON DELETE CASCADE,
    payment_date TEXT NOT NULL, amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS moi_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_tamil TEXT, name_english TEXT, village_tamil TEXT, village_english TEXT,
    mobile TEXT, alternate_mobile TEXT, tran_date TEXT, city TEXT,
    income REAL, expenditure REAL, information TEXT,
    up_dated TEXT DEFAULT (datetime('now','localtime')))`,
`CREATE TABLE IF NOT EXISTS app_settings (k TEXT PRIMARY KEY, v TEXT)`,
`CREATE INDEX IF NOT EXISTS ix_ic_cust ON interest_collections(customer_id)`,
`CREATE INDEX IF NOT EXISTS ix_ipc_cust ON interest_principal_collections(customer_id)`,
`CREATE INDEX IF NOT EXISTS ix_bc_cust ON borrower_collections(customer_id)`,
`CREATE INDEX IF NOT EXISTS ix_rp_cust ON rent_payments(customer_id)`,
];

// Backup/restore metadata. Order = parents first (restore deletes in reverse order).
export const TABLES = {
  interest_customers: { cols: ['id','name','village','mobile','principal','principal_balance','rate_of_interest','transaction_date','payment_type','no_of_payments','total_interest_collected','is_active','created_at'],
    dates: ['transaction_date'], notNull: ['name','village','mobile','principal','principal_balance','rate_of_interest','transaction_date','payment_type','is_active'] },
  interest_collections: { cols: ['id','customer_id','collection_date','amount','status','created_at'], dates: ['collection_date'], notNull: ['customer_id','collection_date','amount','status'] },
  interest_principal_collections: { cols: ['id','customer_id','collection_date','amount','status','created_at'], dates: ['collection_date'], notNull: ['customer_id','collection_date','amount','status'] },
  borrower_customers: { cols: ['id','name','village','mobile','principal','balance','transaction_date','payment_type','due_count','day_count','is_active','created_at'],
    dates: ['transaction_date'], notNull: ['name','village','mobile','principal','balance','transaction_date','payment_type','is_active'] },
  borrower_collections: { cols: ['id','customer_id','collection_date','amount','status','created_at'], dates: ['collection_date'], notNull: ['customer_id','collection_date','amount','status'] },
  rent_customers: { cols: ['id','name','village','mobile','rent_amount','agreement_date','status','is_active','created_at'],
    dates: ['agreement_date'], notNull: ['name','village','mobile','rent_amount','agreement_date','is_active'] },
  rent_payments: { cols: ['id','customer_id','payment_date','amount','created_at'], dates: ['payment_date'], notNull: ['customer_id','payment_date','amount'] },
  moi_records: { cols: ['id','name_tamil','name_english','village_tamil','village_english','mobile','alternate_mobile','tran_date','city','income','expenditure','information','up_dated'],
    dates: ['tran_date'], notNull: [] },
};
export const TABLE_ORDER = Object.keys(TABLES);
