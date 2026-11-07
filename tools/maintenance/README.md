# Specialization cleanup

`merge-specializations.sql` is a one-time data repair for SQL Server 2017+.
It removes trailing numeric classification codes, merges names that differ only
by case or surrounding/repeated spaces, and capitalizes Armenian initials.
Different names and nonnumeric qualifiers remain separate. The lowest existing
ID survives, verification is preserved, and all declared foreign keys are moved
to the surviving record. No reference data is seeded.

It works when only reference tables are populated and is safe to run again.
Run during a maintenance window with the application stopped to avoid stale
registration selections. Back up the target database first.

After pulling the commit, either open the SQL file in your SQL client, select the
PolyLink database and execute the entire file, or run from the repository root:

```sh
sqlcmd -S localhost -U sa -C -b -d polylink -i tools/maintenance/merge-specializations.sql
```

Enter the password when prompted. Adjust the server, database and login to match
the machine. For the project's Docker SQL Server (adjust the container name):

```sh
docker exec -i polylink-backend-sqlserver-1 sh -c 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d polylink' < tools/maintenance/merge-specializations.sql
```

The result reports removed duplicates, transferred foreign-key values and the
remaining specialization count. Counts depend on the target data; a second run
should report zero removals and transfers. Errors roll back the transaction.
Then restart the application and reload the registration page.

Only declared database relationships are transferred. The script does not rewrite
free-text profile descriptions or historical audit payloads. Unsupported composite
foreign keys cause an explicit error rather than a partial repair.

# Alumni Excel import (macOS and Linux)

The tracked importer `import_alumni.py` is independent of the ignored legacy
script. It defaults to **polylink_fresh**, localhost:1433, SQL login `sa`.
The target database must already have the application schema/migrations and seed
references. Back it up and stop the application before applying an import.
If reference duplicates exist, run `merge-specializations.sql` against
**polylink_fresh** first (select that database in DataGrip).

Use Python 3.11 or newer. From the repository root after `git pull`:

```sh
python3 -m venv .venv-alumni
source .venv-alumni/bin/activate
python -m pip install -r tools/maintenance/requirements-alumni.txt
```

Place the workbook at `db/alumni.xlsx`, or use its actual path in the commands.
The workbook is transferred separately: do not commit personal data or passwords.
The default sheet is `Sheet1`, with headers on Excel row 3. Names must be in
**surname, first name, optional patronymic** order; only surname and first name
are stored. Gender and qualification columns are ignored. Required headers are
listed in `HEADERS` in the script.

First preview the complete plan (no inserts, including no new references):

```sh
python tools/maintenance/import_alumni.py db/alumni.xlsx --database polylink_fresh --dry-run --create-specializations
```

Enter the SQL Server password when prompted. Review the counts and proposed new
specialization names. If everything is correct, apply the same plan:

```sh
python tools/maintenance/import_alumni.py db/alumni.xlsx --database polylink_fresh --apply --create-specializations
```

`--create-specializations` explicitly permits adding missing specialization names
without numeric codes, with `IsVerified=0`. Omit it to require all specializations
to exist already. It does not invent or change existing reference IDs. Distinct
names are not fuzzily matched. Existing reference duplicates abort the import.
Existing single reference names are reused, not renamed; run the cleanup SQL
first if those names still contain codes.

For a different connection, append `--host HOST --port PORT --user LOGIN`, using
the same host and published port as DataGrip. A SQL Server Docker container must
already be running and its port accessible from macOS. Do not use its internal
container hostname unless accessible from the Mac. `DB_HOST`, `DB_PORT`, `DB_USER`
and `DB_PASSWORD` environment variables are also supported. The script deliberately
does not read or print `.env` files; the database is chosen only by `--database`
(default `polylink_fresh`). Connections require encryption.

The importer checks required fields, UTF-16 lengths, real dates, study date order,
reference ambiguity, and diploma conflicts. Dates may be Excel dates or
`DD/MM/YYYY` / `YYYY-MM-DD` with an optional parenthesized order number. A trailing
`(YYYY)` is removed from diploma numbers. Import columns must contain values,
not formulas. Completely blank rows are ignored; invalid nonblank rows fail the
whole import and are reported by Excel row number.

Identical repeated diplomas are skipped. A repeated diploma with different names,
dates or specialization aborts instead of overwriting data. Normalization for
matching follows enrollment rules: Unicode NFKC, whitespace collapse, lowercase.
All new references and alumni are committed together; any validation or database
error rolls everything back. Apply locks both affected tables during the import.
No users, accounts, lecturer records or claims are created or modified.

Success prints `APPLY: transaction committed`. Repeating the command should report
zero inserts and all previously imported records as already imported. Restart the
application and reload registration afterward. Errors return a nonzero exit code;
database errors intentionally omit raw SQL messages that could contain personal
data. If necessary, investigate locally using database logs.

Verified on SQL Server using the actual workbook: dry-run writes no rows, apply
imports 395 rows, and repeating apply inserts zero. Tests also cover an incomplete
reference seed, missing-reference rejection, diploma conflicts, reference
ambiguity and rollback after an insertion fails. macOS setup uses a Python virtual
environment; it does not require the ignored legacy importer or `sqlcmd`.

Run unit tests:

```sh
python -m unittest discover -s tools/maintenance -p 'test_import_alumni.py' -v
```

To include integration tests, set `ALUMNI_TEST_PASSWORD` (optional connection
variables: `ALUMNI_TEST_HOST`, `ALUMNI_TEST_PORT`, `ALUMNI_TEST_USER`). They create
and drop their own uniquely named temporary database; the login needs permission
to do so. They never target `polylink_fresh` or `polylink`.
