package am.polylink;

import static org.assertj.core.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import am.polylink.storage.*;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;

/** The existing attachment ACL/race suite also runs across the SQL/object boundary. */
@Import(ObjectStorageIT.Objects.class)
class ObjectStorageIT extends MessengerStateIT {
    @TestConfiguration
    static class Objects {
        @Bean
        MemoryStorage memoryStorage() {
            return new MemoryStorage();
        }
    }

    static class MemoryStorage implements ObjectStorage {
        final Map<String, byte[]> bytes = new ConcurrentHashMap<>();
        volatile boolean failPut, failDelete;

        @Override
        public void put(String k, Path p, String type) {
            if (failPut) throw AuthFailure.unavailable();
            try {
                bytes.put(k, Files.readAllBytes(p));
            } catch (IOException e) {
                throw AuthFailure.unavailable();
            }
        }

        @Override
        public Download get(String k) {
            var value = bytes.get(k);
            if (value == null) throw AuthFailure.unavailable();
            return new Download(new ByteArrayInputStream(value), value.length);
        }

        @Override
        public long size(String k) {
            return bytes.get(k).length;
        }

        @Override
        public void delete(String k) {
            if (failDelete) throw AuthFailure.unavailable();
            bytes.remove(k);
        }

        @Override
        public Page list(String p, String c) {
            return new Page(
                    bytes.keySet().stream()
                            .filter(k -> k.startsWith(p))
                            .map(k -> new Entry(k, Instant.now()))
                            .toList(),
                    null);
        }
    }

    @Autowired MemoryStorage objects;
    @Autowired StorageCleanup objectCleanup;

    @Test
    void interruptedPutCanRetryButDeletionCannotResurrectIt() throws Exception {
        var a = fixture.configured();
        var b = fixture.configured();
        String room = direct(a, b),
                id = UUID.randomUUID().toString(),
                path = "/chat/rooms/" + room + "/attachments";
        byte[] bytes = new byte[32];
        new Random(7).nextBytes(bytes);
        try {
            objects.failPut = true;
            assertThat(binary(a, path, id, bytes).statusCode()).isEqualTo(503);
            assertThat(
                            db.queryForObject(
                                    "SELECT StorageState FROM messaging.Attachments WHERE AttachmentId=?",
                                    String.class,
                                    id))
                    .isEqualTo("UPLOADING");
            objects.failPut = false;
            db.update(
                    "UPDATE messaging.Attachments SET LeaseUntil=? WHERE AttachmentId=?",
                    OffsetDateTime.now().minusMinutes(1),
                    id);
            assertThat(binary(a, path, id, bytes).statusCode()).isEqualTo(201);
            String key =
                    db.queryForObject(
                            "SELECT ObjectKey FROM messaging.Attachments WHERE AttachmentId=?",
                            String.class,
                            id);
            assertThat(objects.bytes.get(key)).isEqualTo(bytes);
            db.update(
                    "UPDATE messaging.Attachments SET ExpiresAt=? WHERE AttachmentId=?",
                    OffsetDateTime.now().minusSeconds(1),
                    id);
            cleanup.expire();
            objects.failDelete = true;
            objectCleanup.clean();
            assertThat(objects.bytes).containsKey(key);
            assertThat(binary(a, path, id, bytes).statusCode()).isEqualTo(409);
            objects.failDelete = false;
            db.update("UPDATE messaging.Attachments SET RetryAt=NULL WHERE AttachmentId=?", id);
            objectCleanup.clean();
            assertThat(objects.bytes).doesNotContainKey(key);
            assertThat(
                            db.queryForObject(
                                    "SELECT StorageState FROM messaging.Attachments WHERE AttachmentId=?",
                                    String.class,
                                    id))
                    .isEqualTo("DELETED");
        } finally {
            objects.failPut = false;
            objects.failDelete = false;
        }
    }
}
