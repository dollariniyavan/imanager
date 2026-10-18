import Foundation
import SQLite3

struct DBError: Error {
    let msg: String
    init(_ m: String) { msg = m }
}

/// SQLite wrapper that mirrors the Android native side: every call takes/returns JSON strings,
/// and returns {"error": "..."} on failure. Calls fail with "locked" until the user authenticates.
final class Database {
    private var db: OpaquePointer?
    private(set) var locked = true
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    func lock() { locked = true }
    func unlock() { locked = false }

    // MARK: public API (called from NativeBridge)

    func initSchema(_ schemaJSON: String) -> String {
        if locked { return fail("locked") }
        do {
            try open()
            guard let stmts = try JSONSerialization.jsonObject(with: Data(schemaJSON.utf8)) as? [String] else {
                throw DBError("Bad schema")
            }
            for s in stmts { try exec(s) }
            try exec("CREATE TABLE IF NOT EXISTS app_settings (k TEXT PRIMARY KEY, v TEXT)")
            return enc(["ok": true])
        } catch { return fail(message(error)) }
    }

    func query(_ sql: String, _ paramsJSON: String) -> String {
        if locked { return fail("locked") }
        do {
            try open()
            let st = try prepare(sql, try parseParams(paramsJSON))
            defer { sqlite3_finalize(st) }
            var rows: [[String: Any]] = []
            let n = sqlite3_column_count(st)
            while true {
                let rc = sqlite3_step(st)
                if rc == SQLITE_DONE { break }
                guard rc == SQLITE_ROW else { throw DBError(lastError()) }
                var row: [String: Any] = [:]
                for c in 0..<n {
                    let name = String(cString: sqlite3_column_name(st, c))
                    switch sqlite3_column_type(st, c) {
                    case SQLITE_INTEGER: row[name] = sqlite3_column_int64(st, c)
                    case SQLITE_FLOAT:   row[name] = sqlite3_column_double(st, c)
                    case SQLITE_TEXT:    row[name] = String(cString: sqlite3_column_text(st, c))
                    default:             row[name] = NSNull()
                    }
                }
                rows.append(row)
            }
            return enc(rows)
        } catch { return fail(message(error)) }
    }

    func run(_ sql: String, _ paramsJSON: String) -> String {
        if locked { return fail("locked") }
        do {
            try open()
            try runStatement(try prepare(sql, try parseParams(paramsJSON)))
            return enc(["lastId": sqlite3_last_insert_rowid(db), "changes": Int(sqlite3_changes(db))])
        } catch { return fail(message(error)) }
    }

    /// [{statement, values}] executed in ONE transaction; all-or-nothing.
    func batch(_ json: String) -> String {
        if locked { return fail("locked") }
        do {
            try open()
            guard let items = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else {
                throw DBError("Bad batch")
            }
            try exec("BEGIN")
            do {
                for it in items {
                    let sql = it["statement"] as? String ?? ""
                    let vals = it["values"] as? [Any] ?? []
                    try runStatement(try prepare(sql, vals))
                }
                try exec("COMMIT")
            } catch {
                try? exec("ROLLBACK")
                throw error
            }
            return enc(["ok": true])
        } catch { return fail(message(error)) }
    }

    // MARK: internals

    private func open() throws {
        if db != nil { return }
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                              appropriateFor: nil, create: true)
        let url = dir.appendingPathComponent("loan_manager.sqlite")
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw DBError("Cannot open database") }
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                               ofItemAtPath: url.path)
        try exec("PRAGMA foreign_keys = ON")   // the schema relies on ON DELETE CASCADE
    }

    private func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            let m = err.map { String(cString: $0) } ?? "SQL error"
            sqlite3_free(err)
            throw DBError(m)
        }
    }

    private func prepare(_ sql: String, _ params: [Any]) throws -> OpaquePointer {
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let stmt = st else {
            let m = lastError(); sqlite3_finalize(st); throw DBError(m)
        }
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            switch p {
            case is NSNull:
                sqlite3_bind_null(stmt, idx)
            case let n as NSNumber:
                if CFGetTypeID(n) == CFBooleanGetTypeID() { sqlite3_bind_int(stmt, idx, n.boolValue ? 1 : 0) }
                else if CFNumberIsFloatType(n) { sqlite3_bind_double(stmt, idx, n.doubleValue) }
                else { sqlite3_bind_int64(stmt, idx, n.int64Value) }
            case let s as String:
                sqlite3_bind_text(stmt, idx, s, -1, transient)
            default:
                sqlite3_bind_text(stmt, idx, "\(p)", -1, transient)
            }
        }
        return stmt
    }

    private func runStatement(_ st: OpaquePointer) throws {
        defer { sqlite3_finalize(st) }
        while true {
            let rc = sqlite3_step(st)
            if rc == SQLITE_ROW { continue }
            if rc == SQLITE_DONE { return }
            throw DBError(lastError())
        }
    }

    private func parseParams(_ s: String) throws -> [Any] {
        if s.isEmpty { return [] }
        guard let a = try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [Any] else { throw DBError("Bad parameters") }
        return a
    }

    private func lastError() -> String { db != nil ? String(cString: sqlite3_errmsg(db)) : "Database not open" }
    private func message(_ e: Error) -> String { (e as? DBError)?.msg ?? e.localizedDescription }
    private func fail(_ m: String) -> String { enc(["error": m]) }
    private func enc(_ obj: Any) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return "{\"error\":\"Could not encode result\"}" }
        return s
    }
}
