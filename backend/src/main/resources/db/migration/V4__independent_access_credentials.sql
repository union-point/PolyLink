-- Refresh rotation must not invalidate still-valid access credentials in other tabs.
CREATE TABLE auth.AccessTokens (
    AccessHash binary(32) NOT NULL CONSTRAINT PK_AccessTokens PRIMARY KEY,
    SessionId uniqueidentifier NOT NULL REFERENCES auth.Sessions(SessionId),
    ExpiresAt datetimeoffset(3) NOT NULL
);
INSERT auth.AccessTokens(AccessHash,SessionId,ExpiresAt)
SELECT AccessHash,SessionId,AccessExpiresAt FROM auth.Sessions;
CREATE INDEX IX_AccessTokens_Expiry ON auth.AccessTokens(ExpiresAt);
CREATE INDEX IX_AccessTokens_Session ON auth.AccessTokens(SessionId);
