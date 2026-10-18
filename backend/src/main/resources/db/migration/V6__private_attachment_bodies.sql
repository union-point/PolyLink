-- Private ciphertext object storage shares SQL's atomic binding and backup boundary.
-- Attachment metadata retains its immutable client UUID/digest after binding.
CREATE TABLE messaging.AttachmentBodies (
    AttachmentId uniqueidentifier NOT NULL CONSTRAINT PK_AttachmentBodies PRIMARY KEY
        REFERENCES messaging.Attachments(AttachmentId) ON DELETE CASCADE,
    Ciphertext varbinary(max) NOT NULL,
    CONSTRAINT CK_AttachmentBodySize CHECK (DATALENGTH(Ciphertext) BETWEEN 17 AND 5242896)
);
GO
