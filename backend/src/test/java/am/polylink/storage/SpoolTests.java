package am.polylink.storage;

import static org.junit.jupiter.api.Assertions.*;

import am.polylink.auth.AuthFailure;
import java.io.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SpoolTests {
    @TempDir Path directory;

    @Test
    void boundsChunkedInputAndRemovesInterruptedFiles() throws Exception {
        assertThrows(
                AuthFailure.class,
                () -> Spool.read(directory, new ByteArrayInputStream(new byte[50]), 1, 49));
        assertThrows(
                AuthFailure.class,
                () ->
                        Spool.read(
                                directory,
                                new InputStream() {
                                    public int read() throws IOException {
                                        throw new IOException();
                                    }
                                },
                                1,
                                49));
        try (var files = Files.list(directory)) {
            assertEquals(0, files.count());
        }
        Path file;
        try (var spool =
                Spool.read(directory, new ByteArrayInputStream(new byte[] {1, 2, 3}), 1, 49)) {
            file = spool.path();
            assertEquals(3, spool.size());
            assertEquals(32, spool.digest().length);
        }
        assertFalse(Files.exists(file));
    }

    @Test
    void readbackRejectsCorruptionEvenWithMatchingLength() {
        try (var spool =
                Spool.read(directory, new ByteArrayInputStream(new byte[] {1, 2, 3}), 1, 49)) {
            ObjectStorage storage =
                    new ObjectStorage() {
                        public void put(String k, Path p, String t) {}

                        public Download get(String k) {
                            return new Download(new ByteArrayInputStream(new byte[] {3, 2, 1}), 3);
                        }

                        public long size(String k) {
                            return 3;
                        }

                        public void delete(String k) {}

                        public Page list(String p, String c) {
                            return new Page(java.util.List.of(), null);
                        }
                    };
            assertThrows(
                    AuthFailure.class,
                    () -> Spool.verify(storage, "key", spool.size(), spool.digest()));
        }
    }
}
