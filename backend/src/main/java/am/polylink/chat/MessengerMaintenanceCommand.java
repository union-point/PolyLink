package am.polylink.chat;

import am.polylink.auth.*;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Explicit operator operations; no HTTP endpoint can invoke deletion replay. */
public final class MessengerMaintenanceCommand {
    private MessengerMaintenanceCommand() {}

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing " + key);
        return value;
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 0
                || !(args[0].equals("export-deletions") && args.length == 1
                        || args[0].equals("replay-deletions") && args.length == 2))
            throw new IllegalArgumentException(
                    "Use export-deletions or replay-deletions ledger.json");
        var properties = new Properties();
        properties.setProperty("databaseName", required("DB_NAME"));
        properties.setProperty("user", required("MIGRATION_DB_USERNAME"));
        properties.setProperty("password", required("MIGRATION_DB_PASSWORD"));
        properties.setProperty("encrypt", "true");
        properties.setProperty(
                "trustServerCertificate",
                System.getenv().getOrDefault("DB_TRUST_SERVER_CERTIFICATE", "false"));
        properties.setProperty("loginTimeout", "10");
        var source = new DriverManagerDataSource();
        source.setUrl(
                "jdbc:sqlserver://"
                        + System.getenv().getOrDefault("DB_HOST", "localhost")
                        + ":"
                        + System.getenv().getOrDefault("DB_PORT", "1433"));
        source.setConnectionProperties(properties);
        var db = new JdbcTemplate(source);
        var json = JsonMapper.builder().build();
        var chat =
                new ChatService(
                        db,
                        new Accounts(db),
                        new TransactionTemplate(new DataSourceTransactionManager(source)),
                        json,
                        Clock.systemUTC());
        var groups = new GroupService(chat);
        switch (args[0]) {
            case "export-deletions" ->
                    System.out.println(
                            json.writeValueAsString(
                                    Map.of(
                                            "userIds",
                                            db.queryForList(
                                                    "SELECT UserId FROM auth.AccountDeletions ORDER BY UserId",
                                                    String.class))));
            case "replay-deletions" -> {
                var ledger = json.readTree(Files.readString(Path.of(args[1])));
                if (!ledger.isObject() || ledger.size() != 1 || !ledger.path("userIds").isArray())
                    throw new IllegalArgumentException("Invalid deletion ledger");
                var ids = new TreeSet<Integer>();
                for (var id : ledger.path("userIds")) ids.add(ChatDtos.user(id.asText()));
                var lifecycle =
                        new AccountLifecycle(
                                chat, groups, new IdentityConfiguration().loginSecretEncoder());
                for (int id : ids) lifecycle.replayDeletion(id);
                System.out.println("Deletion ledger replay completed.");
            }
            default -> throw new IllegalArgumentException("Unknown command");
        }
    }
}
