"""Run unit tests; set ALUMNI_TEST_PASSWORD to also test a disposable SQL database."""
from datetime import date
import os
import unittest
import uuid

from import_alumni import Record, import_records, key, parse_date, specialization


class ParsingTests(unittest.TestCase):
    def test_specialization_and_unicode_matching(self):
        self.assertEqual(key(specialization(' Տեղեկատվական  տեխնոլոգիաներ (061105.00.6) ')),
                         key('տեղեկատվական տեխնոլոգիաներ'))
        self.assertEqual(specialization('Առանձին (որակավորում)'), 'Առանձին (որակավորում)')
        self.assertEqual(key(' ＡＢ\u00a0 12 '), 'ab 12')

    def test_dates_preserve_day_month_and_ignore_order_number(self):
        self.assertEqual(parse_date('01/09/2021 (01-05/3230)'), date(2021, 9, 1))
        self.assertEqual(parse_date('2025-06-30'), date(2025, 6, 30))
        for invalid in ['31/02/2021', '45200', '2025', 'order 01/09/2021']:
            with self.assertRaises(ValueError):
                parse_date(invalid)


@unittest.skipUnless(os.getenv('ALUMNI_TEST_PASSWORD'), 'No disposable database credentials')
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import pymssql
        cls.options = dict(server=os.getenv('ALUMNI_TEST_HOST', 'localhost'),
                           port=os.getenv('ALUMNI_TEST_PORT', '1433'),
                           user=os.getenv('ALUMNI_TEST_USER', 'sa'),
                           password=os.environ['ALUMNI_TEST_PASSWORD'], charset='UTF-8',
                           tds_version='7.4', encryption='require')
        cls.name = 'polylink_import_test_' + uuid.uuid4().hex
        cls.admin = pymssql.connect(**cls.options, database='master', autocommit=True)
        cls.admin.cursor().execute(f'CREATE DATABASE [{cls.name}]')
        cls.conn = pymssql.connect(**cls.options, database=cls.name, autocommit=False)
        cls.conn.cursor().execute('''
            CREATE TABLE dbo.Specializations(
              SpecializationId int IDENTITY PRIMARY KEY, Name nvarchar(255) UNIQUE,
              IsVerified bit NOT NULL DEFAULT 0);
            CREATE TABLE dbo.AlumniRegistry(
              AlumniRegistryId int IDENTITY PRIMARY KEY, FirstName nvarchar(100) NOT NULL,
              LastName nvarchar(100) NOT NULL, DiplomaNumber nvarchar(100) NOT NULL UNIQUE,
              StudyStartDate date NOT NULL, StudyEndDate date NOT NULL,
              SpecializationId int REFERENCES dbo.Specializations,
              CHECK(StudyStartDate<=StudyEndDate), CHECK(DiplomaNumber<>N'REJECT'));
        ''')
        cls.conn.commit()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()
        cls.admin.cursor().execute(f'DROP DATABASE [{cls.name}]')
        cls.admin.close()

    def setUp(self):
        c = self.conn.cursor()
        c.execute('DELETE dbo.AlumniRegistry; DELETE dbo.Specializations;')
        c.execute('INSERT dbo.Specializations(Name,IsVerified) VALUES (%s,1)', ('Էլեկտրոնիկա',))
        self.conn.commit()

    def record(self, diploma='TEST', spec='Էլեկտրոնիկա'):
        return Record(4, 'Demo', 'Graduate', diploma, date(2021, 9, 1), date(2025, 6, 1), spec)

    def count(self, table):
        c = self.conn.cursor()
        c.execute('SELECT COUNT(*) FROM dbo.' + table)
        return c.fetchone()[0]

    def test_dry_run_apply_and_repeat(self):
        records = [self.record(), self.record('TEST2', 'Նոր մասնագիտություն')]
        self.assertEqual(import_records(self.conn, records, False, True), (2, 0, 1))
        self.assertEqual(self.count('Specializations'), 1)
        self.assertEqual(self.count('AlumniRegistry'), 0)
        self.assertEqual(import_records(self.conn, records, True, True), (2, 0, 1))
        self.assertEqual(import_records(self.conn, records, True, True), (0, 2, 0))
        self.assertEqual(self.count('AlumniRegistry'), 2)

    def test_unknown_specialization_requires_explicit_flag(self):
        with self.assertRaisesRegex(ValueError, 'Missing specialization'):
            import_records(self.conn, [self.record(spec='Նոր մասնագիտություն')], True)
        self.assertEqual(self.count('Specializations'), 1)
        self.assertEqual(self.count('AlumniRegistry'), 0)

    def test_existing_diploma_conflict_is_not_silently_skipped(self):
        import_records(self.conn, [self.record()], True)
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            import_records(self.conn, [self.record(spec='Different')], True, True)
        self.assertEqual(self.count('Specializations'), 1)
        self.assertEqual(self.count('AlumniRegistry'), 1)

    def test_database_error_rolls_back_new_references_and_all_rows(self):
        import pymssql
        with self.assertRaises(pymssql.IntegrityError):
            import_records(self.conn, [self.record(spec='Նոր մասնագիտություն'),
                                      self.record('REJECT')], True, True)
        self.assertEqual(self.count('Specializations'), 1)
        self.assertEqual(self.count('AlumniRegistry'), 0)

    def test_ambiguous_reference_aborts(self):
        self.conn.cursor().execute('INSERT dbo.Specializations(Name) VALUES (%s)',
                                   ('Էլեկտրոնիկա (071401.00.6)',))
        self.conn.commit()
        with self.assertRaisesRegex(ValueError, 'Duplicate specialization'):
            import_records(self.conn, [self.record()], True)
        self.assertEqual(self.count('AlumniRegistry'), 0)


if __name__ == '__main__':
    unittest.main()
