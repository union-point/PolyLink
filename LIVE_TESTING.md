# Live verification of M1–M6

First complete the [Linux/macOS quickstart in README.md](README.md#run-the-real-application): local setup, OpenBao/mail, explicit migrations, invitations and app startup. The helper scripts replace the old manual environment/key/truststore routine and retain private local state across worktrees. See [tools/local/README.md](tools/local/README.md) for their behavior.

**Users do not save, download or type a recovery key.** Password login and email verification trigger automatic encryption-key setup. Local OpenBao operator credentials are separate from user login. Email-based account/history recovery is available; see [M4 recovery checks](docs/messenger/m4.md).

Before the checks below, verify:

```sh
source tools/local/env.sh
./backend/mvnw --version
curl --fail http://localhost:3004/actuator/health
```

Use `http://localhost:8001` consistently. If ports 3004/8001 are already occupied, make sure their processes serve this checkout. Stop old app processes with Ctrl+C in their original terminals; inspect listeners with `lsof -nP -iTCP:3004 -sTCP:LISTEN` / `lsof -nP -iTCP:8001 -sTCP:LISTEN` (or `ss -lptn` on Linux). Keep SQL/OpenBao volumes and local state.

## 1. Register and test encrypted text messaging

1. Open a normal browser profile at [the registration page](http://localhost:8001/register.html).
2. Register `alice@example.invalid` with role **graduate** and a password you choose. The password must contain 8–128 characters, an uppercase letter, a number and a symbol.
3. Open [Mailpit](http://localhost:8025), find the message addressed to Alice and enter its six-digit code in the registration page. Codes expire after ten minutes; use the latest email.
4. Wait for login and automatic encryption-key setup to finish and for the profile page to open. There is no recovery-key task for Alice.
5. Open a **separate browser profile or a different browser** for Bob. Register and verify `bob@example.invalid` in the same way. Two ordinary tabs share cookies and do not represent two independent users.
6. In Alice's browser, open [Search](http://localhost:8001/search.html), find Bob and click **Connect**. The direct conversation opens.
7. Send a text message. In Bob's browser, open [Messages](http://localhost:8001/message.html). The text should appear within a few seconds while the page is visible. Reply from Bob and confirm Alice receives it.
8. For the offline-recipient check, close Bob's browser after his setup has completed. Send another message from Alice, then reopen Bob's browser. Bob should be able to read it without any key exchange or action by Alice.

Encrypted images and personal actions are implemented in [M5](docs/messenger/m5.md), and dynamic groups, export and lifecycle in [M6](docs/messenger/m6.md). Apply migrations through V7 before testing. Some unrelated profile/forum/settings actions remain unavailable; HTTP mode never substitutes mock data.

## 2. Test session continuity and password change

### Page and browser continuity

In Alice's browser:

1. Navigate from Profile to Messages, Search and Settings.
2. Reload the page and open another tab in the **same browser profile**.
3. Close and reopen the browser, using the same persistent profile and `localhost:8001`.

Expected: a valid session and working secure browser storage restore the keys automatically. No repeated password or chat-specific unlock is required. If IndexedDB/CryptoKey storage is blocked, the UI explains why password entry is needed after navigation; password-based reading on the current page remains possible.

To test a genuinely new device, use another clean browser profile and log in with Alice's password. Its permitted history should open without Bob being online, without creating a new identity, and without manually importing a key.

### Ordinary password change

1. Keep Alice logged in in two separate browser profiles, representing two devices.
2. In one profile, open [Settings](http://localhost:8001/settings.html), expand the Password editor, enter the current password and confirm a new password.
3. If email verification is enabled for the account, complete the inline code step using Mailpit.
4. Confirm that the current browser is signed in and can still read the old conversation. Send another text.
5. In the other profile, refocus/reload or access Messages. Its old session should be rejected.
6. Confirm the old password no longer logs in and the new password opens the same history in a clean profile.

Unrelated settings toggles are currently disabled in HTTP mode. You do not need to enable any of them to change the password.

## 3. If something fails

| Symptom | What to check |
| --- | --- |
| Port 3004/8001 already in use, or old behavior still appears | Stop the old app processes and start both servers from this checkout. Reload the browser afterward. |
| `release version 25 not supported`, missing `javac`, or wrong Maven JVM | Select the full JDK 25, export its `JAVA_HOME`/`PATH`, then check `./mvnw --version`. |
| Backend does not start or reports missing auth tables | Check the SQL credentials and run the explicit upgrade through V4. Starting the backend never applies migrations. |
| Registration produces no verification email | Check the invitation's exact email/role, Mailpit and SMTP port 1025. Uninvited registration is deliberately neutral. |
| Verification succeeds but key setup cannot finish | Check OpenBao is unsealed, the JVM trusts its certificate, and `OPENBAO_TOKEN_FILE` points to a valid narrow service token. Retry login after fixing the prerequisite. |
| Token stopped working after a long shutdown | The backend token is periodic and needs renewal. If it expired while the backend was stopped, an operator must issue/install a replacement using the [runbook](infra/openbao/README.md). Keep the existing Transit key and volume. |
| Origin/cookie/refresh failures | Use `localhost` consistently, port 8001 for the frontend, and the matching allowed origin. Do not open HTML via `file://`. |
| Sending says a participant is unconfigured | Both users must finish a verified password login and automatic setup at least once. |
| Browser asks for a password after navigation | Check secure browser storage permissions and whether the session expired/was revoked. A signed-out profile must perform normal login. |
| Old demo chats/users are absent | The HTTP messenger does not seed mock accounts or silently import legacy plaintext messages. Register the invited test users. |
| Too many email attempts | Respect resend/aggregate limits. Do not repeatedly register the same address or restart verification to bypass a limit. |

## 4. Optional: run the complete automated checks

Manual live testing does not require these frontend test dependencies. For the reproducible acceptance suite, keep the same full JDK selected and run from the project root:

```sh
source tools/local/env.sh
bash tools/local/test.sh --full
```

Use separate test-administrator credentials if your runtime SQL user cannot create/drop disposable databases. Node 22+ is required for this optional suite. The runner provisions its own temporary SQL database, TLS OpenBao and Mailpit on separate ports, runs M1–M3 checks and cleans them up. It does not upgrade your working database or use your live OpenBao instance. It also proves clean-browser login/history and ordinary password change while its test OpenBao instance is sealed.

## 5. Stop and resume later

Use Ctrl+C in the frontend/backend terminals. Keep the existing SQL/OpenBao volumes and the local environment file. On the next run, check infrastructure and unseal status, then run `source tools/local/env.sh`, and repeat the backend/frontend one-liners in the root README. Run the upgrade step again after pulling new migrations; existing admitted users simply log in.

The backend renews its OpenBao service token while running. After a sufficiently long shutdown, new account setup may need `bash tools/local/provision-openbao.sh` or an operator-issued replacement token even though existing password-based logins and message history can work without OpenBao.


## 6. Test dynamic groups and own-data boundaries

1. In Messages, choose **Create group**, enter a name, find Bob and select him. Bob may be offline after completing key setup.
2. Open **Group members** to rename the group, add another admitted/configured account, remove a member or transfer ownership. Only the owner receives management controls; a member may leave. An owner with other members must transfer ownership first.
3. Send text and an image before and after an addition. The newcomer sees only messages sent after joining. Remove and re-add Bob: his new server history starts after rejoining, including images, previews, export and old-send results. Remaining participants retain their history.
4. Reload after a removal or close the owner's browser. Another current unlocked participant resumes pending key rotation automatically. Text drafts survive reload encrypted in secure storage; browsers require selecting unsent files again.
5. In Settings, download own data and confirm the export includes only your accessible authored messages/images and no encryption-key material. Use disposable accounts to test deactivation/deletion: deactivation suspends access, while deletion removes own bodies, closes direct sending and transfers owned groups deterministically. See the M6 operator instructions before production use.

Run `python3 tools/m1/verify.py --groups` for the full disposable M1–M6 acceptance suite, or `bash tools/local/test.sh --full` to install test dependencies and run it. M7 retains the supported-platform and operational restore rehearsals.
