package am.polylink.auth;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@IdentityEnabled
public class Accounts {
    public record Account(
            int id,
            String email,
            String firstName,
            String lastName,
            String role,
            long credential,
            byte[] salt,
            int ops,
            long memory,
            String verifier,
            String admission,
            boolean verified,
            boolean emailFactor,
            long vaultKey,
            long vaultRevision,
            long identity) {
        public AuthDtos.Versions versions() {
            return new AuthDtos.Versions(
                    "" + credential, "" + vaultKey, "" + vaultRevision, "" + identity);
        }

        public void requireAdmitted() {
            if (!verified || !admission.equals("ADMITTED")) throw AuthFailure.denied();
        }

        public Map<String, Object> user() {
            return Map.of(
                    "id",
                    "" + id,
                    "firstName",
                    firstName,
                    "lastName",
                    lastName,
                    "role",
                    role,
                    "admission",
                    admission,
                    "emailVerified",
                    verified,
                    "emailFactorEnabled",
                    emailFactor,
                    "onboardingComplete",
                    true,
                    "email",
                    email);
        }

        @Override
        public String toString() {
            return "Account[redacted]";
        }
    }

    private final JdbcTemplate db;

    public Accounts(JdbcTemplate db) {
        this.db = db;
    }

    public static String email(String value) {
        return value.strip().toLowerCase(Locale.ROOT);
    }

    public Optional<Account> find(String email) {
        return query("u.Email=?", email).stream().findFirst();
    }

    public Account get(int id) {
        return query("u.UserId=?", id).stream().findFirst().orElseThrow(AuthFailure::denied);
    }

    public Account lock(int id) {
        if (db.queryForList(
                        "SELECT UserId FROM auth.AccountSecurity WITH(UPDLOCK,HOLDLOCK) WHERE UserId=?",
                        id)
                .isEmpty()) throw AuthFailure.denied();
        return get(id);
    }

    private List<Account> query(String where, Object value) {
        return db.query(
                "SELECT u.UserId,u.Email,u.FirstName,u.LastName,COALESCE(p.RoleCode,r.Name) AS RoleCode,s.*,v.VaultKeyVersion,v.VaultRevision,v.IdentityVersion FROM auth.AccountSecurity s JOIN dbo.Users u ON u.UserId=s.UserId JOIN dbo.Roles r ON r.RoleId=u.RoleId LEFT JOIN keyvault.Vaults v ON v.UserId=s.UserId LEFT JOIN auth.PendingEnrollments p ON p.UserId=s.UserId WHERE "
                        + where,
                (rs, n) ->
                        new Account(
                                rs.getInt("UserId"),
                                rs.getString("Email"),
                                rs.getString("FirstName"),
                                rs.getString("LastName"),
                                rs.getString("RoleCode").toLowerCase(Locale.ROOT),
                                rs.getLong("CredentialVersion"),
                                rs.getBytes("ClientSalt"),
                                rs.getInt("ClientOpsLimit"),
                                rs.getLong("ClientMemoryBytes"),
                                rs.getString("LoginVerifier"),
                                rs.getString("AdmissionStatus"),
                                rs.getObject("EmailVerifiedAt") != null,
                                rs.getBoolean("EmailFactorEnabled"),
                                rs.getLong("VaultKeyVersion"),
                                rs.getLong("VaultRevision"),
                                rs.getLong("IdentityVersion")),
                value);
    }
}
