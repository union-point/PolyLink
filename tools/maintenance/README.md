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
