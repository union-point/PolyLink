package am.polylink.auth;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@IdentityEnabled
public class Challenges {
    public record Created(
            UUID id,
            Integer userId,
            String purpose,
            long credential,
            String code,
            OffsetDateTime expires,
            OffsetDateTime resend,
            String email,
            String browserToken) {
        public Map<String, Object> response() {
            return Map.of(
                    "challengeId",
                    id.toString(),
                    "expiresAt",
                    expires.toInstant().toString(),
                    "resendAfter",
                    resend.toInstant().toString());
        }

        @Override
        public String toString() {
            return "Challenge[redacted]";
        }
    }

    private final JdbcTemplate db;
    private final Secrets secrets;
    private final Clock clock;
    private final TransactionTemplate tx;
    private final MailDelivery mail;
    private final Accounts accounts;
    private final RateLimiter limits;

    public Challenges(
            JdbcTemplate db,
            Secrets secrets,
            Clock clock,
            TransactionTemplate tx,
            MailDelivery mail,
            Accounts accounts,
            RateLimiter limits) {
        this.db = db;
        this.secrets = secrets;
        this.clock = clock;
        this.tx = tx;
        this.mail = mail;
        this.accounts = accounts;
        this.limits = limits;
    }

    public Created create(
            Integer userId, String purpose, long credential, String email, String browser) {
        var now = OffsetDateTime.now(clock);
        var id = UUID.randomUUID();
        String code = secrets.code();
        var created =
                new Created(
                        id,
                        userId,
                        purpose,
                        credential,
                        code,
                        now.plusMinutes(10),
                        now.plusSeconds(60),
                        email,
                        browser);
        db.update(
                "INSERT auth.EmailChallenges(ChallengeId,UserId,Purpose,CodeMac,SecretVersion,FailedAttempts,ExpiresAt,ResendAfter,CredentialVersion,BrowserHash,EmailSnapshot) VALUES (?,?,?,?,1,0,?,?,?,?,?)",
                id,
                userId,
                purpose,
                codeMac(id, purpose, credential, code),
                created.expires(),
                created.resend(),
                credential,
                Secrets.hash(browser),
                email);
        return created;
    }

    public void deliver(Created created) {
        if (created.userId() != null)
            mail.sendCode(created.email(), created.purpose(), created.code());
    }

    public Accounts.Account verify(
            AuthDtos.CodeProof proof, String purpose, String browser, String ip) {
        limits.consume("VERIFY_IP", ip, 50, 1800);
        var owner =
                db.queryForList(
                        "SELECT UserId FROM auth.EmailChallenges WHERE ChallengeId=?",
                        Integer.class,
                        proof.challengeId());
        if (!owner.isEmpty() && owner.getFirst() != null)
            limits.consume("VERIFY_ACCOUNT", "" + owner.getFirst(), 10, 1800);
        Accounts.Account user =
                tx.execute(
                        status -> {
                            var rows =
                                    Rows.query(
                                            db,
                                            "SELECT * FROM auth.EmailChallenges WITH(UPDLOCK,HOLDLOCK) WHERE ChallengeId=?",
                                            proof.challengeId());
                            if (rows.isEmpty()) return null;
                            var row = rows.getFirst();
                            var now = OffsetDateTime.now(clock);
                            if (!purpose.equals(row.get("Purpose"))
                                    || row.get("ConsumedAt") != null
                                    || !((OffsetDateTime) row.get("ExpiresAt")).isAfter(now)
                                    || ((Number) row.get("FailedAttempts")).intValue() >= 5
                                    || !Secrets.equal(
                                            (byte[]) row.get("BrowserHash"), Secrets.hash(browser)))
                                return null;
                            long version = ((Number) row.get("CredentialVersion")).longValue();
                            if (!Secrets.equal(
                                    (byte[]) row.get("CodeMac"),
                                    codeMac(proof.challengeId(), purpose, version, proof.code()))) {
                                db.update(
                                        "UPDATE auth.EmailChallenges SET FailedAttempts=FailedAttempts+1 WHERE ChallengeId=?",
                                        proof.challengeId());
                                return null;
                            }
                            Integer id = (Integer) row.get("UserId");
                            if (id == null) return null;
                            var account = accounts.get(id);
                            if (("RECOVERY".equals(purpose)
                                            && !account.email().equals(row.get("EmailSnapshot")))
                                    || account.credential() != version
                                    || !Set.of("PENDING", "ADMITTED").contains(account.admission()))
                                return null;
                            db.update(
                                    "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE ChallengeId=?",
                                    now,
                                    proof.challengeId());
                            return account;
                        });
        if (user == null) throw AuthFailure.denied();
        return user;
    }

    public Created resend(UUID id, String browser, String ip) {
        var rows =
                db.queryForList(
                        "SELECT UserId FROM auth.EmailChallenges WHERE ChallengeId=?",
                        Integer.class,
                        id);
        var account =
                rows.isEmpty() || rows.getFirst() == null ? null : accounts.get(rows.getFirst());
        limits.issue(account == null ? "unknown:" + id : account.email(), ip);
        Created created =
                tx.execute(
                        status -> {
                            var records =
                                    Rows.query(
                                            db,
                                            "SELECT * FROM auth.EmailChallenges WITH(UPDLOCK,HOLDLOCK) WHERE ChallengeId=?",
                                            id);
                            if (records.isEmpty()) throw AuthFailure.denied();
                            var row = records.getFirst();
                            var now = OffsetDateTime.now(clock);
                            if (row.get("ConsumedAt") != null
                                    || !Secrets.equal(
                                            (byte[]) row.get("BrowserHash"), Secrets.hash(browser)))
                                throw AuthFailure.denied();
                            if (account != null
                                    && ((Number) row.get("CredentialVersion")).longValue()
                                            != account.credential()) throw AuthFailure.conflict();
                            if (((OffsetDateTime) row.get("ResendAfter")).isAfter(now))
                                throw new AuthFailure(
                                        429,
                                        "RATE_LIMITED",
                                        "Please wait before requesting another code.");
                            db.update(
                                    "UPDATE auth.EmailChallenges SET ConsumedAt=? WHERE ChallengeId=?",
                                    now,
                                    id);
                            return create(
                                    account == null ? null : account.id(),
                                    (String) row.get("Purpose"),
                                    account == null ? 1 : account.credential(),
                                    account == null ? "" : account.email(),
                                    browser);
                        });
        deliver(created);
        return created;
    }

    private byte[] codeMac(UUID id, String purpose, long credential, String code) {
        return secrets.mac("email-code", id + "/" + purpose + "/" + credential + "/" + code);
    }
}
