#!/usr/bin/env python3
"""Validate and atomically import an Armenian alumni workbook into SQL Server."""
import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
import getpass
import os
from pathlib import Path
import re
import sys
import unicodedata

HEADERS = {
    'full_name': 'Ազգանունը, անունը, հայրանունը',
    'start': 'Ընդունվել է ԲՈՒՀ (հրաման թիվ)',
    'end': 'Ավարտել է ԲՈՒՀը (հրաման թիվ)',
    'diploma': 'Դիպլոմի սերիա/համար (ստացման տարեթիվը)',
    'specialization': 'Մասնագիտություն (կոդ)',
}


def text(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).split())


def key(value):
    # Same normalization as EnrollmentRules.text, including Armenian lowercase.
    return text(value).lower()


def specialization(value):
    return re.sub(r'\s*\([0-9]+(?:\.[0-9]+)+\)\s*$', '', text(value)).strip()


def checked_text(value, field, limit):
    value = text(value)
    if not value or len(value.encode('utf-16-le')) // 2 > limit:
        raise ValueError(f'{field}: missing or longer than {limit} UTF-16 units')
    if any(unicodedata.category(c).startswith('C') for c in value):
        raise ValueError(f'{field}: control or invalid characters')
    return value


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    value = text(value)
    # The workbook contains a date followed by an order number in parentheses.
    match = re.fullmatch(r'(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s*\([^)]*\))?', value)
    if match:
        day, month, year = map(int, match.groups())
        return date(year, month, day)
    match = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})(?:\s*\([^)]*\))?', value)
    if match:
        return date(*map(int, match.groups()))
    raise ValueError('unrecognized date; use DD/MM/YYYY or YYYY-MM-DD, optionally followed by (order)')


@dataclass(frozen=True)
class Record:
    row: int
    first: str
    last: str
    diploma: str
    start: date
    end: date
    spec: str

    def identity(self):
        return (key(self.first), key(self.last), self.start, self.end, key(self.spec))


def read_records(path, sheet, header_row):
    from openpyxl import load_workbook
    workbook = load_workbook(path, read_only=True, data_only=False)
    try:
        if sheet not in workbook.sheetnames:
            raise ValueError(f'Sheet not found: {sheet}')
        ws = workbook[sheet]
        headers = next(ws.iter_rows(min_row=header_row, max_row=header_row, values_only=True))
        indices = {}
        for field, label in HEADERS.items():
            matches = [i for i, v in enumerate(headers) if text(v) == label]
            if len(matches) != 1:
                raise ValueError(f'Header must occur exactly once: {label}')
            indices[field] = matches[0]
        records, errors, seen = [], [], {}
        blank = repeated = 0
        for number, cells in enumerate(ws.iter_rows(min_row=header_row + 1), header_row + 1):
            if all(c.value is None for c in cells):
                blank += 1
                continue
            try:
                if any(cells[i].data_type == 'f' for i in indices.values()):
                    raise ValueError('formula in an import column; replace it with a verified value')
                values = {field: cells[i].value for field, i in indices.items()}
                parts = text(values['full_name']).split()
                if len(parts) < 2:
                    raise ValueError('full_name: expected surname, first name, optional patronymic')
                last = checked_text(parts[0], 'last name', 100)
                first = checked_text(parts[1], 'first name', 100)
                diploma = re.sub(r'\s*\([0-9]{4}\)\s*$', '', text(values['diploma']))
                diploma = checked_text(diploma, 'diploma', 100)
                spec = checked_text(specialization(values['specialization']), 'specialization', 255)
                start, end = parse_date(values['start']), parse_date(values['end'])
                if start > end:
                    raise ValueError('study start is later than study end')
                record = Record(number, first, last, diploma, start, end, spec)
                previous = seen.get(key(diploma))
                if previous:
                    if previous.identity() != record.identity():
                        raise ValueError(f'conflicting diploma also occurs on row {previous.row}')
                    repeated += 1
                else:
                    seen[key(diploma)] = record
                    records.append(record)
            except (ValueError, UnicodeError) as error:
                errors.append(f'Excel row {number}: {error}')
        if not records and not errors:
            errors.append('No alumni records found')
        return records, errors, blank, repeated
    finally:
        workbook.close()


def import_records(connection, records, apply=False, create_specializations=False):
    cursor = connection.cursor()
    try:
        cursor.execute('SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;')
        # In apply mode hold both tables stable through planning and the final commit.
        hint = ' WITH (TABLOCKX, HOLDLOCK)' if apply else ''
        cursor.execute('SELECT SpecializationId, Name FROM dbo.Specializations' + hint)
        specs = defaultdict(list)
        for spec_id, name in cursor.fetchall():
            specs[key(specialization(name))].append((spec_id, name))
        errors = []
        for name, matches in specs.items():
            if len(matches) > 1:
                errors.append(f'Duplicate specialization: {name}; run merge-specializations.sql first')
        if errors:
            raise ValueError('\n'.join(errors))
        cursor.execute('SELECT DiplomaNumber,FirstName,LastName,StudyStartDate,StudyEndDate,SpecializationId '
                       'FROM dbo.AlumniRegistry' + hint)
        existing = defaultdict(list)
        for row in cursor.fetchall():
            existing[key(row[0])].append(row)
        names_by_id = {v[0][0]: k for k, v in specs.items()}
        pending, missing = [], {}
        skipped = 0
        for record in records:
            spec_key = key(record.spec)
            matches = existing.get(key(record.diploma), [])
            if not matches:
                # Also honor the target column's SQL collation (e.g. Latin case).
                cursor.execute('SELECT DiplomaNumber,FirstName,LastName,StudyStartDate,StudyEndDate,SpecializationId '
                               'FROM dbo.AlumniRegistry WHERE DiplomaNumber=%s', (record.diploma,))
                matches = cursor.fetchall()
            if matches:
                def identity(row):
                    return (key(row[1]), key(row[2]), row[3], row[4], names_by_id.get(row[5]))
                if len(matches) != 1 or identity(matches[0]) != record.identity():
                    errors.append(f'Excel row {record.row}: diploma conflicts with existing registry data')
                else:
                    skipped += 1
                continue
            if spec_key not in specs:
                missing.setdefault(spec_key, record.spec[0].upper() + record.spec[1:])
            pending.append(record)
        if missing and not create_specializations:
            errors.extend('Missing specialization: ' + name for name in missing.values())
            errors.append('Review these names; rerun with --create-specializations to add them without codes')
        if errors:
            raise ValueError('\n'.join(errors))
        print(f'To insert: {len(pending)}; already imported: {skipped}; new specializations: {len(missing)}')
        for name in missing.values():
            print(f'  New specialization: {name}')
        if not apply:
            connection.rollback()
            print('DRY RUN: no data written')
            return len(pending), skipped, len(missing)
        for spec_key, name in missing.items():
            cursor.execute('INSERT dbo.Specializations(Name,IsVerified) '
                           'OUTPUT INSERTED.SpecializationId VALUES (%s,0)', (name,))
            specs[spec_key] = [(cursor.fetchone()[0], name)]
        for record in pending:
            cursor.execute('INSERT dbo.AlumniRegistry '
                           '(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId) '
                           'VALUES (%s,%s,%s,%s,%s,%s)',
                           (record.first, record.last, record.diploma, record.start, record.end,
                            specs[key(record.spec)][0][0]))
        connection.commit()
        print('APPLY: transaction committed')
        return len(pending), skipped, len(missing)
    except BaseException:
        connection.rollback()
        raise
    finally:
        cursor.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--database', default='polylink_fresh')
    parser.add_argument('--host', default=os.getenv('DB_HOST', 'localhost'))
    parser.add_argument('--port', type=int, default=int(os.getenv('DB_PORT', '1433')))
    parser.add_argument('--user', default=os.getenv('DB_USER', 'sa'))
    parser.add_argument('--sheet', default='Sheet1')
    parser.add_argument('--header-row', type=int, default=3, help='1-based Excel header row')
    parser.add_argument('--create-specializations', action='store_true')
    args = parser.parse_args()
    if args.header_row < 1 or not 1 <= args.port <= 65535:
        parser.error('header row must be positive; port must be 1..65535')
    try:
        records, errors, blank, repeated = read_records(args.file, args.sheet, args.header_row)
        print(f'Valid unique records: {len(records)}; identical file duplicates: {repeated}; blank rows: {blank}')
        if errors:
            raise ValueError('\n'.join(errors))
        import pymssql
        password = os.getenv('DB_PASSWORD')
        if password is None:
            password = getpass.getpass('SQL Server password: ')
        print(f'Target: {args.host}:{args.port}/{args.database}; mode: {"APPLY" if args.apply else "DRY RUN"}')
        connection = pymssql.connect(server=args.host, port=str(args.port), database=args.database,
                                     user=args.user, password=password, charset='UTF-8',
                                     tds_version='7.4', encryption='require', autocommit=False,
                                     login_timeout=15, timeout=60, appname='PolyLink alumni import')
        try:
            import_records(connection, records, args.apply, args.create_specializations)
        finally:
            connection.close()
        return 0
    except (ValueError, OSError, ImportError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1
    except Exception as error:
        # SQL exceptions can contain inserted personal data; do not echo raw messages.
        print(f'ERROR: {type(error).__name__}; import not committed. Check connection, '
              'schema, permissions and database constraints.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
