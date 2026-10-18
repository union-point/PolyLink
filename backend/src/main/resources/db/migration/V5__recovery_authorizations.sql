-- Separate, purpose-limited capability. No refresh/access token grants recovery access.
CREATE TABLE auth.RecoveryAuthorizations (
    OperationId uniqueidentifier NOT NULL CONSTRAINT PK_RecoveryAuthorizations PRIMARY KEY
        REFERENCES keyvault.Operations(OperationId),
    TokenHash binary(32) NOT NULL CONSTRAINT UQ_RecoveryToken UNIQUE,
    CsrfHash binary(32) NOT NULL,
    VerifiedEmail nvarchar(255) NOT NULL,
    LoginHandoffUsed bit NOT NULL CONSTRAINT DF_RecoveryHandoff DEFAULT 0
);
GO

ALTER TABLE auth.EmailChallenges ADD EmailSnapshot nvarchar(255) NULL;
GO
