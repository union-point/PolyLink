package am.polylink.chat;

import am.polylink.auth.AuthFailure;
import am.polylink.auth.Secrets;
import java.util.*;

public final class ChatDtos {
    private ChatDtos() {}

    public record Direct(String userId) {
        public Direct {
            user(userId);
        }
    }

    public record Versions(String membership, String roomKey) {
        public Versions {
            if (counter(membership) < 1) throw AuthFailure.invalid();
            counter(roomKey);
        }
    }

    public record Recipient(String userId, String identityVersion, String publicKey) {}

    public record RecipientVersion(String userId, String identityVersion) {
        public RecipientVersion {
            user(userId);
            if (counter(identityVersion) < 1) throw AuthFailure.invalid();
        }
    }

    public record Snapshot(
            String roomId, Versions versions, List<Recipient> recipients, String keyState) {}

    public record Envelope(String userId, String identityVersion, String sealedPacket) {
        public Envelope {
            user(userId);
            if (counter(identityVersion) < 1) throw AuthFailure.invalid();
            binary(sealedPacket, 49, 1024);
        }
    }

    public record Activation(Snapshot expected, String newKeyVersion, List<Envelope> envelopes) {
        public Activation {
            if (expected == null
                    || envelopes == null
                    || envelopes.isEmpty()
                    || envelopes.size() > 100
                    || envelopes.stream().anyMatch(Objects::isNull)
                    || counter(newKeyVersion) < 1) throw AuthFailure.invalid();
            envelopes = List.copyOf(envelopes);
        }
    }

    public record Packet(String scheme, String nonce, String ciphertext) {
        public void validate() {
            if (!"PLK1".equals(scheme)) throw AuthFailure.invalid();
            Secrets.decode(nonce, 24);
            binary(ciphertext, 17, 32784);
        }

        @Override
        public String toString() {
            return "Packet[redacted]";
        }
    }

    public record Send(
            String operationId,
            Versions expected,
            List<RecipientVersion> recipientVersions,
            Packet packet,
            String attachmentId) {
        public Send {
            uuid(operationId);
            if (expected == null
                    || packet == null
                    || recipientVersions == null
                    || recipientVersions.size() < 2
                    || recipientVersions.size() > 100
                    || recipientVersions.stream().anyMatch(Objects::isNull))
                throw AuthFailure.invalid();
            if (attachmentId != null) uuid(attachmentId);
            packet.validate();
            recipientVersions = List.copyOf(recipientVersions);
        }
    }

    public record Read(String throughSequence) {
        public Read {
            counter(throughSequence);
        }
    }

    public record Toggle(Boolean enabled) {
        public Toggle {
            if (enabled == null) throw AuthFailure.invalid();
        }
    }

    public static long counter(String value) {
        try {
            if (value == null || !value.matches("0|[1-9][0-9]{0,18}")) throw AuthFailure.invalid();
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw AuthFailure.invalid();
        }
    }

    public static int user(String value) {
        long id = counter(value);
        if (id < 1 || id > Integer.MAX_VALUE) throw AuthFailure.invalid();
        return (int) id;
    }

    public static UUID uuid(String value) {
        try {
            var id = UUID.fromString(value);
            if (!id.toString().equals(value)) throw AuthFailure.invalid();
            return id;
        } catch (IllegalArgumentException | NullPointerException e) {
            throw AuthFailure.invalid();
        }
    }

    public static byte[] binary(String value, int min, int max) {
        try {
            if (value == null || value.length() > (max * 4 + 2) / 3) throw AuthFailure.invalid();
            byte[] bytes = Base64.getUrlDecoder().decode(value);
            if (bytes.length < min || bytes.length > max || !Secrets.encode(bytes).equals(value))
                throw AuthFailure.invalid();
            return bytes;
        } catch (IllegalArgumentException e) {
            throw AuthFailure.invalid();
        }
    }
}
