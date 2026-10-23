package am.polylink.settings;

import am.polylink.auth.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class SettingsService {
    private final JdbcTemplate db;
    private final Accounts accounts;
    private final TransactionTemplate tx;
    private static final Map<String, String> FIELDS =
            Map.of(
                    "isProfilePublic",
                    "IsProfilePublic",
                    "showEmail",
                    "ShowEmail",
                    "language",
                    "LanguageId",
                    "emailEnabled",
                    "EmailEnabled",
                    "newListingNotifications",
                    "NewListingNotifications",
                    "forumReplyNotifications",
                    "ForumReplyNotifications",
                    "directMessageNotifications",
                    "DirectMessageNotifications");

    public SettingsService(JdbcTemplate db, Accounts accounts, TransactionTemplate tx) {
        this.db = db;
        this.accounts = accounts;
        this.tx = tx;
    }

    public static void validate(Map<String, Object> patch) {
        if (patch.isEmpty()) throw AuthFailure.invalid();
        patch.forEach(
                (key, value) -> {
                    if (!FIELDS.containsKey(key)) throw AuthFailure.invalid();
                    if (key.equals("language")) {
                        if (!(value instanceof String) || !Set.of("hy", "en", "ru").contains(value))
                            throw AuthFailure.invalid();
                    } else if (!(value instanceof Boolean)) throw AuthFailure.invalid();
                });
    }

    public Map<String, Object> get(int user) {
        var r =
                Rows.query(
                                db,
                                "SELECT u.IsProfilePublic,u.ShowEmail,l.Code,n.*,a.EmailFactorEnabled FROM dbo.Users u JOIN dbo.Languages l ON l.Id=u.LanguageId JOIN dbo.UserNotificationSettings n ON n.UserId=u.UserId JOIN auth.AccountSecurity a ON a.UserId=u.UserId WHERE u.UserId=?",
                                user)
                        .getFirst();
        var result = new LinkedHashMap<String, Object>();
        FIELDS.forEach(
                (key, column) ->
                        result.put(key, key.equals("language") ? r.get("Code") : r.get(column)));
        result.put("twoFactorEnabled", r.get("EmailFactorEnabled"));
        return result;
    }

    public Map<String, Object> update(int user, Map<String, Object> patch) {
        validate(patch);
        return tx.execute(
                s -> {
                    accounts.lock(user).requireAdmitted();
                    patch.forEach(
                            (key, value) -> {
                                String column = FIELDS.get(key);
                                if (key.equals("language"))
                                    db.update(
                                            "UPDATE dbo.Users SET LanguageId=(SELECT Id FROM dbo.Languages WHERE Code=?) WHERE UserId=?",
                                            value,
                                            user);
                                else
                                    db.update(
                                            "UPDATE dbo."
                                                    + (Set.of("isProfilePublic", "showEmail")
                                                                    .contains(key)
                                                            ? "Users"
                                                            : "UserNotificationSettings")
                                                    + " SET "
                                                    + column
                                                    + "=? WHERE UserId=?",
                                            value,
                                            user);
                            });
                    return get(user);
                });
    }
}
